import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  USERS: "cfgpt_users",
  CURRENT_USER: "cfgpt_current_user",
  CONVERSATIONS: "cfgpt_conversations",
  VOICE_SAMPLES: "cfgpt_voice_samples",
  SIP_CONFIG: "cfgpt_sip_config",
  RECEPTIONIST_CONFIG: "cfgpt_receptionist_config",
  FREE_TRIAL_LIMIT: "cfgpt_free_trial_limit",
  MATRIX_SETTINGS: "cfgpt_matrix_settings",
  VOICE_REQUESTS: "cfgpt_voice_requests",
};

export interface AppUser {
  id: string;
  email: string;
  password: string;
  name: string;
  role: "super_admin" | "admin" | "user";
  credits: number;
  voiceCredits: number;
  hasPaidViaPaypal: boolean;
  blocked: boolean;
  createdAt: string;
  freeTrialMessages: number;
  usedMessages: number;
  freePhotoGenerations: number;
  usedPhotoGenerations: number;
  freeVideoGenerations: number;
  usedVideoGenerations: number;
}

export interface VoiceRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  voiceFileUri: string;
  voiceFileName: string;
  prompt: string;
  assignedNumber: string;
  status: "pending" | "in_progress" | "complete";
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  userId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  mode?: "personality" | "normal";
  providerId?: string;
  personality?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface VoiceSample {
  id: string;
  userId: string;
  name: string;
  provider: "resemble" | "elevenlabs" | "cfgpt";
  uri: string;
  duration: number;
  status: "uploaded" | "training" | "ready";
  isActive: boolean;
  createdAt: string;
}

export interface SipConfig {
  userId: string;
  providerName: string;
  domain: string;
  port: number;
  username: string;
  authUsername: string;
  password: string;
  transport: "TCP" | "UDP" | "TLS";
  inboundNumber: string;
  allowedNumbers: string[];
}

export interface ReceptionistConfig {
  userId: string;
  name: string;
  companyName: string;
  greeting: string;
  closingMessage: string;
  holdMessage: string;
  afterHoursMessage: string;
  aiProvider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  faqEntries: { question: string; answer: string }[];
}

let msgCounter = 0;
export function generateId(): string {
  msgCounter++;
  return `${Date.now()}-${msgCounter}-${Math.random().toString(36).substr(2, 9)}`;
}

const SUPER_ADMIN_EMAIL = "smmasolutionsltd@gmail.com";

export async function initializeApp(): Promise<void> {
  const users = await getUsers();
  const superAdmin = users.find((u) => u.email === SUPER_ADMIN_EMAIL);
  if (!superAdmin) {
    const admin: AppUser = {
      id: generateId(),
      email: SUPER_ADMIN_EMAIL,
      password: "admin123",
      name: "SMA Solutions",
      role: "super_admin",
      credits: 999999,
      voiceCredits: 999999,
      hasPaidViaPaypal: true,
      blocked: false,
      createdAt: new Date().toISOString(),
      freeTrialMessages: 50,
      usedMessages: 0,
      freePhotoGenerations: 1,
      usedPhotoGenerations: 0,
      freeVideoGenerations: 1,
      usedVideoGenerations: 0,
    };
    await saveUser(admin);
  }
  const trialLimit = await AsyncStorage.getItem(KEYS.FREE_TRIAL_LIMIT);
  if (!trialLimit) {
    await AsyncStorage.setItem(KEYS.FREE_TRIAL_LIMIT, "5");
  }
}

export async function getUsers(): Promise<AppUser[]> {
  const data = await AsyncStorage.getItem(KEYS.USERS);
  return data ? JSON.parse(data) : [];
}

export async function saveUser(user: AppUser): Promise<void> {
  const users = await getUsers();
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx >= 0) {
    users[idx] = user;
  } else {
    users.push(user);
  }
  await AsyncStorage.setItem(KEYS.USERS, JSON.stringify(users));
}

export async function deleteUser(userId: string): Promise<void> {
  const users = await getUsers();
  const filtered = users.filter((u) => u.id !== userId);
  await AsyncStorage.setItem(KEYS.USERS, JSON.stringify(filtered));
}

export async function getUserByEmail(
  email: string
): Promise<AppUser | undefined> {
  const users = await getUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const data = await AsyncStorage.getItem(KEYS.CURRENT_USER);
  return data ? JSON.parse(data) : null;
}

export async function setCurrentUser(user: AppUser | null): Promise<void> {
  if (user) {
    await AsyncStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
  } else {
    await AsyncStorage.removeItem(KEYS.CURRENT_USER);
  }
}

export async function getConversations(
  userId: string
): Promise<Conversation[]> {
  const data = await AsyncStorage.getItem(KEYS.CONVERSATIONS);
  const all: Conversation[] = data ? JSON.parse(data) : [];
  return all
    .filter((c) => c.userId === userId)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.CONVERSATIONS);
  const all: Conversation[] = data ? JSON.parse(data) : [];
  const idx = all.findIndex((c) => c.id === conv.id);
  if (idx >= 0) {
    all[idx] = conv;
  } else {
    all.push(conv);
  }
  await AsyncStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(all));
}

export async function deleteConversation(convId: string): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.CONVERSATIONS);
  const all: Conversation[] = data ? JSON.parse(data) : [];
  const filtered = all.filter((c) => c.id !== convId);
  await AsyncStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(filtered));
}

export async function getVoiceSamples(userId: string): Promise<VoiceSample[]> {
  const data = await AsyncStorage.getItem(KEYS.VOICE_SAMPLES);
  const all: VoiceSample[] = data ? JSON.parse(data) : [];
  return all.filter((v) => v.userId === userId);
}

export async function saveVoiceSample(sample: VoiceSample): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.VOICE_SAMPLES);
  const all: VoiceSample[] = data ? JSON.parse(data) : [];
  const idx = all.findIndex((v) => v.id === sample.id);
  if (idx >= 0) {
    all[idx] = sample;
  } else {
    all.push(sample);
  }
  await AsyncStorage.setItem(KEYS.VOICE_SAMPLES, JSON.stringify(all));
}

export async function deleteVoiceSample(sampleId: string): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.VOICE_SAMPLES);
  const all: VoiceSample[] = data ? JSON.parse(data) : [];
  const filtered = all.filter((v) => v.id !== sampleId);
  await AsyncStorage.setItem(KEYS.VOICE_SAMPLES, JSON.stringify(filtered));
}

export async function getSipConfig(
  userId: string
): Promise<SipConfig | null> {
  const data = await AsyncStorage.getItem(KEYS.SIP_CONFIG);
  const all: SipConfig[] = data ? JSON.parse(data) : [];
  return all.find((c) => c.userId === userId) || null;
}

export async function saveSipConfig(config: SipConfig): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.SIP_CONFIG);
  const all: SipConfig[] = data ? JSON.parse(data) : [];
  const idx = all.findIndex((c) => c.userId === config.userId);
  if (idx >= 0) {
    all[idx] = config;
  } else {
    all.push(config);
  }
  await AsyncStorage.setItem(KEYS.SIP_CONFIG, JSON.stringify(all));
}

export async function getReceptionistConfig(
  userId: string
): Promise<ReceptionistConfig | null> {
  const data = await AsyncStorage.getItem(KEYS.RECEPTIONIST_CONFIG);
  const all: ReceptionistConfig[] = data ? JSON.parse(data) : [];
  return all.find((c) => c.userId === userId) || null;
}

export async function saveReceptionistConfig(
  config: ReceptionistConfig
): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.RECEPTIONIST_CONFIG);
  const all: ReceptionistConfig[] = data ? JSON.parse(data) : [];
  const idx = all.findIndex((c) => c.userId === config.userId);
  if (idx >= 0) {
    all[idx] = config;
  } else {
    all.push(config);
  }
  await AsyncStorage.setItem(KEYS.RECEPTIONIST_CONFIG, JSON.stringify(all));
}

export interface MatrixSettings {
  userId: string;
  enabled: boolean;
  color: "green" | "red" | "blue";
  expiresAt: string | null;
}

export async function getMatrixSettings(
  userId: string
): Promise<MatrixSettings> {
  const data = await AsyncStorage.getItem(KEYS.MATRIX_SETTINGS);
  const all: MatrixSettings[] = data ? JSON.parse(data) : [];
  const found = all.find((m) => m.userId === userId);
  return found || { userId, enabled: false, color: "green", expiresAt: null };
}

export async function saveMatrixSettings(
  settings: MatrixSettings
): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.MATRIX_SETTINGS);
  const all: MatrixSettings[] = data ? JSON.parse(data) : [];
  const idx = all.findIndex((m) => m.userId === settings.userId);
  if (idx >= 0) {
    all[idx] = settings;
  } else {
    all.push(settings);
  }
  await AsyncStorage.setItem(KEYS.MATRIX_SETTINGS, JSON.stringify(all));
}

export async function getFreeTrialLimit(): Promise<number> {
  const data = await AsyncStorage.getItem(KEYS.FREE_TRIAL_LIMIT);
  return data ? parseInt(data, 10) : 10;
}

export async function setFreeTrialLimit(limit: number): Promise<void> {
  await AsyncStorage.setItem(KEYS.FREE_TRIAL_LIMIT, limit.toString());
}

export async function getVoiceRequests(): Promise<VoiceRequest[]> {
  const data = await AsyncStorage.getItem(KEYS.VOICE_REQUESTS);
  return data ? JSON.parse(data) : [];
}

export async function saveVoiceRequest(req: VoiceRequest): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.VOICE_REQUESTS);
  const all: VoiceRequest[] = data ? JSON.parse(data) : [];
  const idx = all.findIndex((r) => r.id === req.id);
  if (idx >= 0) {
    all[idx] = req;
  } else {
    all.push(req);
  }
  await AsyncStorage.setItem(KEYS.VOICE_REQUESTS, JSON.stringify(all));
}

export async function deleteVoiceRequest(reqId: string): Promise<void> {
  const data = await AsyncStorage.getItem(KEYS.VOICE_REQUESTS);
  const all: VoiceRequest[] = data ? JSON.parse(data) : [];
  const filtered = all.filter((r) => r.id !== reqId);
  await AsyncStorage.setItem(KEYS.VOICE_REQUESTS, JSON.stringify(filtered));
}

export function ensureUserFields(user: AppUser): AppUser {
  return {
    ...user,
    voiceCredits: user.voiceCredits ?? 0,
    hasPaidViaPaypal: user.hasPaidViaPaypal ?? false,
  };
}
