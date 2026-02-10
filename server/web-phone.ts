import { SipService, type SipConfigServer } from "./sip-service";
import { generateCompletion } from "./ai-providers";
import { textToSpeech } from "./replit_integrations/audio/client";
import { textToSpeech as elevenLabsTts } from "./elevenlabs";
import { broadcastToUser } from "./ws-events";

const DEFAULT_EL_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

async function generateTtsAudio(text: string, voice: string): Promise<Buffer> {
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const voiceId = voice || DEFAULT_EL_VOICE_ID;
      console.log(`[WEB-PHONE] Using ElevenLabs TTS, voice: ${voiceId}`);
      return await elevenLabsTts(voiceId, text);
    } catch (err: any) {
      console.log(`[WEB-PHONE] ElevenLabs TTS failed, falling back to Replit TTS: ${err.message}`);
    }
  }
  const ttsVoice = (voice || "nova") as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  return await textToSpeech(text, ttsVoice, "wav");
}

export interface WebPhoneSession {
  userId: string;
  sipService: SipService;
  config: SipConnectionConfig;
  autoAnswer: boolean;
  aiGreeting: string;
  aiSystemPrompt: string;
  aiName: string;
  ttsVoice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  callLog: WebPhoneCallRecord[];
  connectedAt: string | null;
}

export interface SipConnectionConfig {
  server: string;
  port: number;
  username: string;
  authUsername: string;
  password: string;
  transport: "TCP" | "UDP";
  phoneNumber: string;
  displayName: string;
}

export interface WebPhoneCallRecord {
  id: string;
  callerNumber: string;
  calledNumber: string;
  timestamp: string;
  duration: number;
  status: "answered" | "missed" | "rejected" | "error";
  aiResponse?: string;
  autoAnswered: boolean;
}

export interface WebPhoneStatus {
  connected: boolean;
  connecting: boolean;
  registered: boolean;
  error: string | null;
  autoAnswer: boolean;
  activeCall: boolean;
  callsHandled: number;
  lastCallAt: string | null;
  sipUri: string | null;
  uptime: number | null;
  config: {
    server: string;
    port: number;
    username: string;
    transport: string;
    phoneNumber: string;
    displayName: string;
  } | null;
}

const sessions = new Map<string, WebPhoneSession>();

function genCallId(): string {
  return "wp_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

export async function connectWebPhone(
  userId: string,
  sipConfig: SipConnectionConfig,
  aiConfig?: {
    autoAnswer?: boolean;
    greeting?: string;
    systemPrompt?: string;
    name?: string;
    ttsVoice?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  let existing = sessions.get(userId);
  if (existing) {
    try {
      await existing.sipService.unregister();
    } catch {}
  }

  const sipService = new SipService();
  const session: WebPhoneSession = {
    userId,
    sipService,
    config: sipConfig,
    autoAnswer: aiConfig?.autoAnswer !== false,
    aiGreeting: aiConfig?.greeting || "Hello, thank you for calling. How can I help you today?",
    aiSystemPrompt: aiConfig?.systemPrompt || "You are a professional AI receptionist. Be helpful, friendly, and concise. Answer questions about the business and take messages when needed.",
    aiName: aiConfig?.name || "AI Receptionist",
    ttsVoice: (aiConfig?.ttsVoice as any) || "nova",
    callLog: existing?.callLog || [],
    connectedAt: null,
  };

  sipService.setCallHandler(async (callerNumber, calledNumber, callId) => {
    console.log(`[WEB-PHONE] Incoming call for user ${userId}: ${callerNumber} -> ${calledNumber}`);

    const record: WebPhoneCallRecord = {
      id: genCallId(),
      callerNumber,
      calledNumber,
      timestamp: new Date().toISOString(),
      duration: 0,
      status: "answered",
      autoAnswered: session.autoAnswer,
    };

    broadcastToUser(userId, {
      type: "call_incoming",
      userId,
      data: { callerNumber, calledNumber, callId, autoAnswer: session.autoAnswer },
      timestamp: new Date().toISOString(),
    });

    if (!session.autoAnswer) {
      record.status = "missed";
      session.callLog.unshift(record);
      if (session.callLog.length > 200) session.callLog = session.callLog.slice(0, 200);
      console.log(`[WEB-PHONE] Call missed (auto-answer off): ${callerNumber}`);

      broadcastToUser(userId, {
        type: "call_missed",
        userId,
        data: { callerNumber, calledNumber, callId },
        timestamp: new Date().toISOString(),
      });

      return "The person you are trying to reach is not available right now. Please try again later.";
    }

    broadcastToUser(userId, {
      type: "call_answered",
      userId,
      data: { callerNumber, calledNumber, callId },
      timestamp: new Date().toISOString(),
    });

    try {
      const systemPrompt = `${session.aiSystemPrompt}

You are ${session.aiName}, answering calls for ${sipConfig.displayName || sipConfig.phoneNumber}.
This is an incoming call from ${callerNumber}.
Your greeting is: "${session.aiGreeting}"

CRITICAL RULES FOR PHONE CALLS:
- This will be converted to speech
- Keep it SHORT - 2 to 3 sentences maximum
- Do NOT use markdown, bullet points, asterisks, or any formatting
- Speak naturally as if on the phone
- Be warm, professional, and helpful
- End by asking how you can help`;

      const aiResponse = await generateCompletion(
        `Incoming call from ${callerNumber}. Greet the caller naturally.`,
        systemPrompt
      );

      record.aiResponse = aiResponse.substring(0, 500);
      session.callLog.unshift(record);
      if (session.callLog.length > 200) session.callLog = session.callLog.slice(0, 200);

      broadcastToUser(userId, {
        type: "ai_response",
        userId,
        data: { callerNumber, callId, response: aiResponse.substring(0, 500) },
        timestamp: new Date().toISOString(),
      });

      console.log(`[WEB-PHONE] AI response for ${callerNumber}: "${aiResponse.substring(0, 100)}..."`);
      return aiResponse;
    } catch (err: any) {
      console.error(`[WEB-PHONE] AI generation error: ${err.message}`);
      record.status = "error";
      record.aiResponse = session.aiGreeting;
      session.callLog.unshift(record);
      if (session.callLog.length > 200) session.callLog = session.callLog.slice(0, 200);

      broadcastToUser(userId, {
        type: "error",
        userId,
        data: { message: err.message, callId },
        timestamp: new Date().toISOString(),
      });

      return session.aiGreeting;
    }
  });

  sessions.set(userId, session);

  const serverConfig: SipConfigServer = {
    domain: sipConfig.server,
    port: sipConfig.port,
    username: sipConfig.username,
    authUsername: sipConfig.authUsername || sipConfig.username,
    password: sipConfig.password,
    transport: sipConfig.transport,
    inboundNumber: sipConfig.phoneNumber,
  };

  console.log(`[WEB-PHONE] Connecting user ${userId} to ${sipConfig.server}:${sipConfig.port} (${sipConfig.transport})...`);

  const success = await sipService.register(serverConfig);

  if (success) {
    session.connectedAt = new Date().toISOString();
    console.log(`[WEB-PHONE] User ${userId} connected successfully to ${sipConfig.server}`);
    broadcastToUser(userId, {
      type: "status_change",
      userId,
      data: { connected: true, server: sipConfig.server },
      timestamp: new Date().toISOString(),
    });
    return { success: true };
  } else {
    const status = sipService.getStatus();
    const error = status.error || "Registration failed. Check your SIP credentials.";
    console.log(`[WEB-PHONE] User ${userId} connection failed: ${error}`);
    return { success: false, error };
  }
}

export async function disconnectWebPhone(userId: string): Promise<boolean> {
  const session = sessions.get(userId);
  if (!session) return false;

  try {
    await session.sipService.unregister();
  } catch {}

  session.connectedAt = null;
  console.log(`[WEB-PHONE] User ${userId} disconnected`);
  return true;
}

export function getWebPhoneStatus(userId: string): WebPhoneStatus {
  const session = sessions.get(userId);
  if (!session) {
    return {
      connected: false,
      connecting: false,
      registered: false,
      error: null,
      autoAnswer: true,
      activeCall: false,
      callsHandled: 0,
      lastCallAt: null,
      sipUri: null,
      uptime: null,
      config: null,
    };
  }

  const sipStatus = session.sipService.getStatus();
  const lastCall = session.callLog.length > 0 ? session.callLog[0].timestamp : null;
  const uptime = session.connectedAt
    ? Math.floor((Date.now() - new Date(session.connectedAt).getTime()) / 1000)
    : null;

  return {
    connected: sipStatus.registered,
    connecting: sipStatus.registering,
    registered: sipStatus.registered,
    error: sipStatus.error,
    autoAnswer: session.autoAnswer,
    activeCall: sipStatus.activeCall,
    callsHandled: sipStatus.callsHandled,
    lastCallAt: lastCall,
    sipUri: sipStatus.sipUri,
    uptime,
    config: {
      server: session.config.server,
      port: session.config.port,
      username: session.config.username,
      transport: session.config.transport,
      phoneNumber: session.config.phoneNumber,
      displayName: session.config.displayName,
    },
  };
}

export function getWebPhoneCallLog(userId: string): WebPhoneCallRecord[] {
  const session = sessions.get(userId);
  return session ? [...session.callLog] : [];
}

export function getWebPhoneLogs(userId: string): string[] {
  const session = sessions.get(userId);
  return session ? session.sipService.getLogs() : [];
}

export function updateWebPhoneSettings(
  userId: string,
  settings: {
    autoAnswer?: boolean;
    aiGreeting?: string;
    aiSystemPrompt?: string;
    aiName?: string;
    ttsVoice?: string;
  }
): boolean {
  const session = sessions.get(userId);
  if (!session) return false;

  if (settings.autoAnswer !== undefined) session.autoAnswer = settings.autoAnswer;
  if (settings.aiGreeting) session.aiGreeting = settings.aiGreeting;
  if (settings.aiSystemPrompt) session.aiSystemPrompt = settings.aiSystemPrompt;
  if (settings.aiName) session.aiName = settings.aiName;
  if (settings.ttsVoice) session.ttsVoice = settings.ttsVoice as any;

  return true;
}

export function clearWebPhoneCallLog(userId: string): boolean {
  const session = sessions.get(userId);
  if (!session) return false;
  session.callLog = [];
  return true;
}

export function getActiveWebPhoneCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.sipService.getStatus().registered) count++;
  }
  return count;
}

export function getAllWebPhoneSessions(): Array<{
  userId: string;
  connected: boolean;
  server: string;
  phoneNumber: string;
  autoAnswer: boolean;
  callsHandled: number;
}> {
  const result: Array<any> = [];
  for (const [userId, session] of sessions.entries()) {
    const status = session.sipService.getStatus();
    result.push({
      userId,
      connected: status.registered,
      server: session.config.server,
      phoneNumber: session.config.phoneNumber,
      autoAnswer: session.autoAnswer,
      callsHandled: status.callsHandled,
    });
  }
  return result;
}
