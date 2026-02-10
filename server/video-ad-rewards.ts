const DAILY_VIDEO_AD_LIMIT = 10;
const COOLDOWN_MS = 60_000;

interface UserVideoAdState {
  watchedToday: number;
  lastWatchDate: string;
  lastWatchTime: number;
}

const userStates = new Map<string, UserVideoAdState>();

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getUserState(userId: string): UserVideoAdState {
  const state = userStates.get(userId) || { watchedToday: 0, lastWatchDate: "", lastWatchTime: 0 };
  if (state.lastWatchDate !== todayKey()) {
    state.watchedToday = 0;
    state.lastWatchDate = todayKey();
  }
  return state;
}

export function getVideoAdStatus(userId: string): { watchedToday: number; limit: number; remaining: number; cooldownMs: number } {
  const state = getUserState(userId);
  const now = Date.now();
  const elapsed = now - state.lastWatchTime;
  const cooldownMs = state.lastWatchTime > 0 && elapsed < COOLDOWN_MS ? COOLDOWN_MS - elapsed : 0;

  return {
    watchedToday: state.watchedToday,
    limit: DAILY_VIDEO_AD_LIMIT,
    remaining: DAILY_VIDEO_AD_LIMIT - state.watchedToday,
    cooldownMs,
  };
}

export function recordVideoAdWatch(userId: string): { success: boolean; credits?: number; remaining?: number; error?: string; cooldownMs?: number } {
  const state = getUserState(userId);

  if (state.watchedToday >= DAILY_VIDEO_AD_LIMIT) {
    return { success: false, error: `Daily limit reached (${DAILY_VIDEO_AD_LIMIT}/day). Come back tomorrow!` };
  }

  const now = Date.now();
  const elapsed = now - state.lastWatchTime;
  if (state.lastWatchTime > 0 && elapsed < COOLDOWN_MS) {
    return { success: false, error: "Please wait before watching another ad", cooldownMs: COOLDOWN_MS - elapsed };
  }

  state.watchedToday += 1;
  state.lastWatchTime = now;
  userStates.set(userId, state);

  return {
    success: true,
    credits: 1,
    remaining: DAILY_VIDEO_AD_LIMIT - state.watchedToday,
  };
}
