const DAILY_LINK_CLICK_LIMIT = 5;
const COOLDOWN_MS = 30_000;

interface UserLinkClickState {
  clickedToday: number;
  lastClickDate: string;
  lastClickTime: number;
}

const userStates = new Map<string, UserLinkClickState>();

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getUserState(userId: string): UserLinkClickState {
  const state = userStates.get(userId) || { clickedToday: 0, lastClickDate: "", lastClickTime: 0 };
  if (state.lastClickDate !== todayKey()) {
    state.clickedToday = 0;
    state.lastClickDate = todayKey();
  }
  return state;
}

export function getLinkClickStatus(userId: string): { clickedToday: number; limit: number; remaining: number; cooldownMs: number } {
  const state = getUserState(userId);
  const now = Date.now();
  const elapsed = now - state.lastClickTime;
  const cooldownMs = state.lastClickTime > 0 && elapsed < COOLDOWN_MS ? COOLDOWN_MS - elapsed : 0;

  return {
    clickedToday: state.clickedToday,
    limit: DAILY_LINK_CLICK_LIMIT,
    remaining: DAILY_LINK_CLICK_LIMIT - state.clickedToday,
    cooldownMs,
  };
}

export function recordLinkClick(userId: string): { success: boolean; credits?: number; remaining?: number; error?: string; cooldownMs?: number } {
  const state = getUserState(userId);

  if (state.clickedToday >= DAILY_LINK_CLICK_LIMIT) {
    return { success: false, error: `Daily limit reached (${DAILY_LINK_CLICK_LIMIT}/day). Come back tomorrow!` };
  }

  const now = Date.now();
  const elapsed = now - state.lastClickTime;
  if (state.lastClickTime > 0 && elapsed < COOLDOWN_MS) {
    return { success: false, error: "Please wait before clicking another link", cooldownMs: COOLDOWN_MS - elapsed };
  }

  state.clickedToday += 1;
  state.lastClickTime = now;
  userStates.set(userId, state);

  return {
    success: true,
    credits: 1,
    remaining: DAILY_LINK_CLICK_LIMIT - state.clickedToday,
  };
}
