const DAILY_CAPTCHA_LIMIT = 10;
const COOLDOWN_MS = 30_000;

interface CaptchaChallenge {
  id: string;
  answer: string;
  createdAt: number;
  used: boolean;
}

interface UserCaptchaState {
  solvedToday: number;
  lastSolveDate: string;
  lastSolveTime: number;
}

const activeChallenges = new Map<string, CaptchaChallenge>();
const userStates = new Map<string, UserCaptchaState>();

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getUserState(userId: string): UserCaptchaState {
  const state = userStates.get(userId) || { solvedToday: 0, lastSolveDate: "", lastSolveTime: 0 };
  if (state.lastSolveDate !== todayKey()) {
    state.solvedToday = 0;
    state.lastSolveDate = todayKey();
  }
  return state;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

const MATH_OPS = [
  (a: number, b: number) => ({ text: `${a} + ${b}`, answer: a + b }),
  (a: number, b: number) => ({ text: `${a} x ${b}`, answer: a * b }),
  (a: number, b: number) => {
    const big = Math.max(a, b);
    const small = Math.min(a, b);
    return { text: `${big} - ${small}`, answer: big - small };
  },
];

export function generateCaptcha(userId: string): { id: string; imageHtml: string; remaining: number } | { error: string; cooldownMs?: number } {
  const state = getUserState(userId);

  if (state.solvedToday >= DAILY_CAPTCHA_LIMIT) {
    return { error: `Daily limit reached (${DAILY_CAPTCHA_LIMIT}/day). Come back tomorrow!` };
  }

  const now = Date.now();
  const elapsed = now - state.lastSolveTime;
  if (state.lastSolveTime > 0 && elapsed < COOLDOWN_MS) {
    return { error: "Please wait before solving another captcha", cooldownMs: COOLDOWN_MS - elapsed };
  }

  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 15) + 1;
  const op = MATH_OPS[Math.floor(Math.random() * MATH_OPS.length)];
  const result = op(a, b);

  const colors = ["#00D4AA", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444"];
  const bgColor = "#1a1a2e";
  const textColor = colors[Math.floor(Math.random() * colors.length)];

  const rotation = (Math.random() * 16 - 8).toFixed(1);
  const offsetY = (Math.random() * 6 - 3).toFixed(1);

  const noiseLines: string[] = [];
  for (let i = 0; i < 5; i++) {
    const x1 = Math.random() * 280;
    const y1 = Math.random() * 80;
    const x2 = Math.random() * 280;
    const y2 = Math.random() * 80;
    const lc = colors[Math.floor(Math.random() * colors.length)];
    noiseLines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${lc}" stroke-width="1" opacity="0.3"/>`);
  }

  const noiseDots: string[] = [];
  for (let i = 0; i < 30; i++) {
    const cx = Math.random() * 280;
    const cy = Math.random() * 80;
    const r = Math.random() * 2 + 0.5;
    const dc = colors[Math.floor(Math.random() * colors.length)];
    noiseDots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${dc}" opacity="0.25"/>`);
  }

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80" viewBox="0 0 280 80">
    <rect width="280" height="80" fill="${bgColor}" rx="8"/>
    ${noiseLines.join("")}
    ${noiseDots.join("")}
    <text x="140" y="${45 + parseFloat(offsetY)}" text-anchor="middle" font-size="32" font-weight="bold" font-family="monospace" fill="${textColor}" transform="rotate(${rotation}, 140, 40)" letter-spacing="4">${result.text} = ?</text>
  </svg>`;

  const base64Svg = Buffer.from(svgContent).toString("base64");
  const imageHtml = `data:image/svg+xml;base64,${base64Svg}`;

  const id = generateId();
  activeChallenges.set(id, {
    id,
    answer: result.answer.toString(),
    createdAt: now,
    used: false,
  });

  setTimeout(() => activeChallenges.delete(id), 5 * 60 * 1000);

  return {
    id,
    imageHtml,
    remaining: DAILY_CAPTCHA_LIMIT - state.solvedToday,
  };
}

export function verifyCaptcha(userId: string, challengeId: string, answer: string): { success: boolean; credits?: number; remaining?: number; error?: string; cooldownMs?: number } {
  const state = getUserState(userId);

  if (state.solvedToday >= DAILY_CAPTCHA_LIMIT) {
    return { success: false, error: `Daily limit reached (${DAILY_CAPTCHA_LIMIT}/day)` };
  }

  const now = Date.now();
  const elapsed = now - state.lastSolveTime;
  if (state.lastSolveTime > 0 && elapsed < COOLDOWN_MS) {
    return { success: false, error: "Please wait before solving another captcha", cooldownMs: COOLDOWN_MS - elapsed };
  }

  const challenge = activeChallenges.get(challengeId);
  if (!challenge) {
    return { success: false, error: "Captcha expired. Please get a new one." };
  }

  if (challenge.used) {
    return { success: false, error: "Captcha already used. Get a new one." };
  }

  if (Date.now() - challenge.createdAt > 5 * 60 * 1000) {
    activeChallenges.delete(challengeId);
    return { success: false, error: "Captcha expired. Please get a new one." };
  }

  const trimmed = answer.trim();
  if (trimmed !== challenge.answer) {
    challenge.used = true;
    activeChallenges.delete(challengeId);
    return { success: false, error: "Wrong answer! Try a new captcha." };
  }

  challenge.used = true;
  activeChallenges.delete(challengeId);

  state.solvedToday += 1;
  state.lastSolveTime = now;
  state.lastSolveDate = todayKey();
  userStates.set(userId, state);

  return {
    success: true,
    credits: 1,
    remaining: DAILY_CAPTCHA_LIMIT - state.solvedToday,
  };
}

export function getCaptchaStatus(userId: string): { solvedToday: number; limit: number; remaining: number; cooldownMs: number } {
  const state = getUserState(userId);
  const now = Date.now();
  const elapsed = now - state.lastSolveTime;
  const cooldownMs = state.lastSolveTime > 0 && elapsed < COOLDOWN_MS ? COOLDOWN_MS - elapsed : 0;

  return {
    solvedToday: state.solvedToday,
    limit: DAILY_CAPTCHA_LIMIT,
    remaining: DAILY_CAPTCHA_LIMIT - state.solvedToday,
    cooldownMs,
  };
}
