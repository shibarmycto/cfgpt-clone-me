import { generateCompletion } from "./ai-providers";
import { getMascotSystemPrompt, type PersonalityId } from "./mascot-chat";

export interface VirtualNumberConfig {
  id: string;
  phoneNumber: string;
  sipUsername: string;
  sipPassword: string;
  sipDomain: string;
  sipPort: number;
  displayName: string;
  agentName: string;
  agentGreeting: string;
  agentPersonality: PersonalityId;
  agentSystemPrompt: string;
  voiceSampleUrl?: string;
  voiceSampleId?: string;
  ttsVoice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  isActive: boolean;
  userId: string;
  createdAt: string;
  lastCallAt: string | null;
  callsHandled: number;
  callHistory: CallRecord[];
  agentMemory: Record<string, string[]>;
  billingStartDate: string;
  lastBilledDate: string | null;
  totalMinutesUsed: number;
  dailyCreditCost: number;
  maxMinutesPerDay: number;
}

export interface CallRecord {
  id: string;
  callerNumber: string;
  timestamp: string;
  duration: number;
  status: "answered" | "missed" | "error";
  summary?: string;
  aiResponse?: string;
  audioUrl?: string;
}

interface WebhookPayload {
  cli?: string;
  "cli-withheld"?: string;
  callerNumber?: string;
  calledNumber?: string;
  ddi?: string;
  "ddi-description"?: string;
  callId?: string;
  callid?: string;
  event?: string;
  direction?: string;
  from?: string;
  to?: string;
  connected?: string;
  voicemail?: string;
  "call-duration"?: string;
  "hold-time"?: string;
  "department-selection"?: string;
  "call-date"?: string;
  international?: string;
  [key: string]: any;
}

const virtualNumbers = new Map<string, VirtualNumberConfig>();
const numbersByPhone = new Map<string, VirtualNumberConfig>();

const webhookLog: Array<{
  timestamp: string;
  method: string;
  params: Record<string, any>;
  response: string;
  configFound: boolean;
  error?: string;
}> = [];

const ttsCache = new Map<string, { audio: Buffer; timestamp: number }>();
const TTS_CACHE_TTL = 10 * 60 * 1000;

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

console.log(`[WEBHOOK] Virtual numbers service initialized. Users must add their own numbers via the app.`);

export function createVirtualNumber(
  userId: string,
  data: {
    phoneNumber: string;
    sipUsername: string;
    sipPassword: string;
    sipDomain?: string;
    sipPort?: number;
    displayName?: string;
    agentName?: string;
    agentGreeting?: string;
    agentPersonality?: PersonalityId;
    agentSystemPrompt?: string;
    ttsVoice?: string;
    voiceSampleId?: string;
  }
): VirtualNumberConfig {
  const id = genId();
  const config: VirtualNumberConfig = {
    id,
    phoneNumber: data.phoneNumber,
    sipUsername: data.sipUsername,
    sipPassword: data.sipPassword,
    sipDomain: data.sipDomain || "sip.switchboardfree.co.uk",
    sipPort: data.sipPort || 5060,
    displayName: data.displayName || data.phoneNumber,
    agentName: data.agentName || "AI Receptionist",
    agentGreeting: data.agentGreeting || "Hello, thank you for calling. How can I help you today?",
    agentPersonality: data.agentPersonality || "urban",
    agentSystemPrompt: data.agentSystemPrompt || "You are a professional AI receptionist. Be helpful, friendly, and concise. Answer questions about the business and take messages when needed.",
    ttsVoice: (data.ttsVoice as any) || "nova",
    voiceSampleId: data.voiceSampleId,
    isActive: true,
    userId,
    createdAt: new Date().toISOString(),
    lastCallAt: null,
    callsHandled: 0,
    callHistory: [],
    agentMemory: {},
    billingStartDate: new Date().toISOString(),
    lastBilledDate: null,
    totalMinutesUsed: 0,
    dailyCreditCost: 30,
    maxMinutesPerDay: 3000,
  };

  virtualNumbers.set(id, config);
  numbersByPhone.set(normalizePhone(data.phoneNumber), config);
  console.log(`[WEBHOOK] New virtual number registered: ${data.phoneNumber} by user ${userId}`);
  return config;
}

export function getVirtualNumbers(userId: string): VirtualNumberConfig[] {
  const result: VirtualNumberConfig[] = [];
  for (const config of virtualNumbers.values()) {
    if (config.userId === userId || userId === "system") {
      result.push({ ...config, sipPassword: "***" });
    }
  }
  return result;
}

export function getAllVirtualNumbers(): VirtualNumberConfig[] {
  const result: VirtualNumberConfig[] = [];
  for (const config of virtualNumbers.values()) {
    result.push({ ...config, sipPassword: "***" });
  }
  return result;
}

export function getVirtualNumber(id: string): VirtualNumberConfig | null {
  return virtualNumbers.get(id) || null;
}

export function updateVirtualNumber(
  id: string,
  updates: Partial<VirtualNumberConfig>
): VirtualNumberConfig | null {
  const config = virtualNumbers.get(id);
  if (!config) return null;

  const oldPhone = normalizePhone(config.phoneNumber);

  if (updates.phoneNumber) {
    numbersByPhone.delete(oldPhone);
  }

  const safeUpdates: Partial<VirtualNumberConfig> = {};
  const allowedFields = [
    "phoneNumber", "sipUsername", "sipPassword", "sipDomain", "sipPort",
    "displayName", "agentName", "agentGreeting", "agentPersonality",
    "agentSystemPrompt", "voiceSampleUrl", "isActive", "ttsVoice"
  ] as const;

  for (const key of allowedFields) {
    if (key in updates) {
      (safeUpdates as any)[key] = (updates as any)[key];
    }
  }

  Object.assign(config, safeUpdates);

  numbersByPhone.set(normalizePhone(config.phoneNumber), config);
  return config;
}

export function deleteVirtualNumber(id: string): boolean {
  const config = virtualNumbers.get(id);
  if (!config) return false;
  numbersByPhone.delete(normalizePhone(config.phoneNumber));
  virtualNumbers.delete(id);
  return true;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

function getMemoryForCaller(config: VirtualNumberConfig, callerNumber: string): string {
  const memories = config.agentMemory[callerNumber];
  if (!memories || memories.length === 0) return "";
  return `\n\nPrevious interactions with this caller:\n${memories.slice(-5).join("\n")}`;
}

function addMemoryForCaller(config: VirtualNumberConfig, callerNumber: string, summary: string): void {
  if (!config.agentMemory[callerNumber]) {
    config.agentMemory[callerNumber] = [];
  }
  config.agentMemory[callerNumber].push(`[${new Date().toISOString()}] ${summary}`);
  if (config.agentMemory[callerNumber].length > 20) {
    config.agentMemory[callerNumber] = config.agentMemory[callerNumber].slice(-20);
  }
}

export function getWebhookLog() {
  return [...webhookLog].reverse();
}

export function getRegisteredNumberCount(): number {
  return virtualNumbers.size;
}

export async function handleIncomingWebhook(
  query: WebhookPayload,
  method: string = "GET"
): Promise<{ response: string; numberConfig: VirtualNumberConfig | null; callId: string }> {
  const callerNumber = query.cli || query.callerNumber || query.from || "Unknown";
  const calledNumber = query.ddi || query.calledNumber || query.to || "";
  const callId = query.callId || query.callid || genId();
  const callDuration = query["call-duration"] || "0";
  const isWithheld = query["cli-withheld"] === "true" || query["cli-withheld"] === "1";
  const ddiDescription = query["ddi-description"] || "";
  const callDate = query["call-date"] || new Date().toISOString();

  console.log(`\n========================================`);
  console.log(`[WEBHOOK] INCOMING CALL - ${new Date().toISOString()}`);
  console.log(`[WEBHOOK] Method: ${method}`);
  console.log(`[WEBHOOK] Caller (CLI): ${callerNumber}${isWithheld ? " (WITHHELD)" : ""}`);
  console.log(`[WEBHOOK] Called (DDI): ${calledNumber} ${ddiDescription}`);
  console.log(`[WEBHOOK] Call ID: ${callId}`);
  console.log(`[WEBHOOK] Duration: ${callDuration}s`);
  console.log(`[WEBHOOK] Call Date: ${callDate}`);
  console.log(`[WEBHOOK] Registered numbers: ${virtualNumbers.size}`);
  console.log(`[WEBHOOK] All params:`, JSON.stringify(query, null, 2));
  console.log(`========================================\n`);

  const normalizedCalled = normalizePhone(calledNumber);

  let config: VirtualNumberConfig | null = null;

  if (normalizedCalled) {
    config = numbersByPhone.get(normalizedCalled) || null;
    if (config) {
      console.log(`[WEBHOOK] Matched user's number config: ${config.displayName} (${config.phoneNumber}) — user: ${config.userId}`);
    }
  }

  if (!config) {
    for (const c of virtualNumbers.values()) {
      if (c.isActive) {
        config = c;
        console.log(`[WEBHOOK] No exact DDI match. Using first active number: ${config.displayName} (${config.phoneNumber}) — user: ${config.userId}`);
        break;
      }
    }
  }

  if (!config) {
    console.log(`[WEBHOOK] NO NUMBERS REGISTERED. No user has set up a number yet. Returning default message.`);

    webhookLog.push({
      timestamp: new Date().toISOString(),
      method,
      params: { ...query },
      response: "No number configured",
      configFound: false,
      error: "No user has registered a number yet",
    });
    if (webhookLog.length > 200) {
      webhookLog.splice(0, webhookLog.length - 200);
    }

    return {
      response: "Thank you for calling. This number is not yet configured. Please ask the owner to set up their AI receptionist in the CFGPT app at cfgpt.org.",
      numberConfig: null,
      callId,
    };
  }

  if (!config.isActive) {
    console.log(`[WEBHOOK] Number ${config.phoneNumber} is INACTIVE. Returning offline message.`);
    return {
      response: `Thank you for calling ${config.displayName}. The AI receptionist is currently offline. Please try again later.`,
      numberConfig: config,
      callId,
    };
  }

  config.callsHandled++;
  config.lastCallAt = new Date().toISOString();

  const callerMemory = getMemoryForCaller(config, callerNumber);

  const systemPrompt = `${config.agentSystemPrompt}

You are ${config.agentName}, answering calls for ${config.displayName} (${config.phoneNumber}).
This is an incoming call from ${callerNumber}${isWithheld ? " (number withheld)" : ""}.
${callerMemory}

Your greeting is: "${config.agentGreeting}"

CRITICAL RULES:
- This response will be read aloud to the caller via text-to-speech
- Keep it SHORT - 2 to 3 sentences maximum
- Do NOT use markdown, bullet points, asterisks, or any formatting
- Speak naturally as if you're on the phone
- Be warm, professional, and helpful
- If this is a new caller, use your greeting
- End by asking how you can help`;

  let aiResponse = config.agentGreeting;
  let errorMsg: string | undefined;

  try {
    aiResponse = await generateCompletion(
      `Incoming call from ${callerNumber}. Please greet the caller and offer assistance.`,
      systemPrompt
    );
    console.log(`[WEBHOOK] AI Response generated: "${aiResponse.substring(0, 150)}..."`);
  } catch (error: any) {
    errorMsg = error.message;
    console.error(`[WEBHOOK] AI generation error: ${error.message}`);
    console.error(`[WEBHOOK] Falling back to greeting: "${config.agentGreeting}"`);
  }

  const record: CallRecord = {
    id: callId,
    callerNumber,
    timestamp: new Date().toISOString(),
    duration: parseInt(callDuration) || 0,
    status: errorMsg ? "error" : "answered",
    summary: `Call ${errorMsg ? "error" : "answered"} by AI. Caller: ${callerNumber}`,
    aiResponse: aiResponse.substring(0, 500),
  };
  config.callHistory.unshift(record);
  if (config.callHistory.length > 100) {
    config.callHistory = config.callHistory.slice(0, 100);
  }

  addMemoryForCaller(config, callerNumber, `Answered call. AI said: "${aiResponse.substring(0, 100)}"`);

  webhookLog.push({
    timestamp: new Date().toISOString(),
    method,
    params: { ...query },
    response: aiResponse.substring(0, 300),
    configFound: true,
    error: errorMsg,
  });
  if (webhookLog.length > 200) {
    webhookLog.splice(0, webhookLog.length - 200);
  }

  return { response: aiResponse, numberConfig: config, callId };
}

export function getCachedTTS(callId: string): Buffer | null {
  const entry = ttsCache.get(callId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTS_CACHE_TTL) {
    ttsCache.delete(callId);
    return null;
  }
  return entry.audio;
}

export function cacheTTS(callId: string, audio: Buffer): void {
  ttsCache.set(callId, { audio, timestamp: Date.now() });
  for (const [key, val] of ttsCache.entries()) {
    if (Date.now() - val.timestamp > TTS_CACHE_TTL) {
      ttsCache.delete(key);
    }
  }
}

export function getCallHistory(numberId: string): CallRecord[] {
  const config = virtualNumbers.get(numberId);
  return config ? config.callHistory : [];
}

export function clearCallHistory(numberId: string): boolean {
  const config = virtualNumbers.get(numberId);
  if (!config) return false;
  config.callHistory = [];
  return true;
}

export function getBillingStatus(numberId: string): {
  dailyCost: number;
  maxMinutes: number;
  minutesUsed: number;
  isActive: boolean;
  needsBilling: boolean;
  daysSinceLastBill: number;
  totalOwed: number;
} | null {
  const config = virtualNumbers.get(numberId);
  if (!config) return null;

  const now = new Date();
  const lastBilled = config.lastBilledDate ? new Date(config.lastBilledDate) : new Date(config.billingStartDate);
  const daysSince = Math.floor((now.getTime() - lastBilled.getTime()) / (1000 * 60 * 60 * 24));
  const needsBilling = daysSince >= 1 && config.isActive;
  const totalOwed = daysSince * config.dailyCreditCost;

  return {
    dailyCost: config.dailyCreditCost,
    maxMinutes: config.maxMinutesPerDay,
    minutesUsed: config.totalMinutesUsed,
    isActive: config.isActive,
    needsBilling,
    daysSinceLastBill: daysSince,
    totalOwed,
  };
}

export function markBilled(numberId: string): boolean {
  const config = virtualNumbers.get(numberId);
  if (!config) return false;
  config.lastBilledDate = new Date().toISOString();
  return true;
}

export function addMinutesUsed(numberId: string, minutes: number): boolean {
  const config = virtualNumbers.get(numberId);
  if (!config) return false;
  config.totalMinutesUsed += minutes;
  return true;
}

export function testAgentResponse(
  numberId: string,
  testMessage: string
): Promise<string> {
  const config = virtualNumbers.get(numberId);
  if (!config) return Promise.resolve("Number not found");

  const systemPrompt = `${config.agentSystemPrompt}

You are ${config.agentName}, answering calls for ${config.displayName} (${config.phoneNumber}).
This is a test call.
Your greeting is: "${config.agentGreeting}"

Respond naturally as if answering a phone call. Keep it conversational and professional.
Do not use markdown formatting. Speak naturally.
Keep responses short - 2 to 3 sentences.`;

  return generateCompletion(testMessage || "Hello, is anyone there?", systemPrompt);
}
