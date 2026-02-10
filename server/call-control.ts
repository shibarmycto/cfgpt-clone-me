import { generateCompletion } from "./ai-providers";
import { textToSpeech } from "./replit_integrations/audio/client";
import type { VirtualNumberConfig, CallRecord } from "./virtual-numbers";
import { getVoiceSampleAudio } from "./voice-storage";

export interface ActiveCall {
  id: string;
  callerNumber: string;
  calledNumber: string;
  numberConfig: VirtualNumberConfig;
  startedAt: string;
  lastActivityAt: string;
  conversationHistory: Array<{ role: "caller" | "agent"; text: string; timestamp: string }>;
  audioSegments: Map<string, Buffer>;
  status: "ringing" | "answered" | "in_progress" | "completed" | "failed";
  turnCount: number;
}

const activeCalls = new Map<string, ActiveCall>();

const CALL_TIMEOUT = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, call] of activeCalls.entries()) {
    if (now - new Date(call.lastActivityAt).getTime() > CALL_TIMEOUT) {
      call.status = "completed";
      activeCalls.delete(id);
      console.log(`[CALL-CONTROL] Call ${id} timed out and removed`);
    }
  }
}, 60 * 1000);

function genCallId(): string {
  return "call_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

export function createActiveCall(
  callerNumber: string,
  calledNumber: string,
  config: VirtualNumberConfig,
  existingCallId?: string
): ActiveCall {
  const id = existingCallId || genCallId();
  const call: ActiveCall = {
    id,
    callerNumber,
    calledNumber,
    numberConfig: config,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    conversationHistory: [],
    audioSegments: new Map(),
    status: "answered",
    turnCount: 0,
  };
  activeCalls.set(id, call);
  console.log(`[CALL-CONTROL] Active call created: ${id} | Caller: ${callerNumber} → ${calledNumber}`);
  return call;
}

export function getActiveCall(callId: string): ActiveCall | null {
  return activeCalls.get(callId) || null;
}

export function endCall(callId: string): void {
  const call = activeCalls.get(callId);
  if (call) {
    call.status = "completed";
    activeCalls.delete(callId);
    console.log(`[CALL-CONTROL] Call ended: ${callId} | Turns: ${call.turnCount}`);
  }
}

export function getActiveCallCount(): number {
  return activeCalls.size;
}

export async function generateGreetingAudio(
  config: VirtualNumberConfig,
  callerNumber: string,
  callId: string,
  callerMemory: string = ""
): Promise<{ text: string; audioBuffer: Buffer }> {
  const systemPrompt = `${config.agentSystemPrompt}

You are ${config.agentName}, answering calls for ${config.displayName} (${config.phoneNumber}).
This is an incoming call from ${callerNumber}.
${callerMemory}

Your greeting is: "${config.agentGreeting}"

CRITICAL RULES FOR PHONE CALLS:
- This will be converted to speech and played to the caller
- Keep it SHORT — 2 to 3 sentences maximum
- Do NOT use markdown, bullet points, asterisks, or any formatting
- Do NOT use abbreviations or special characters
- Speak naturally as if on the phone
- Be warm, professional, and helpful
- Use your greeting for the first response
- End by asking how you can help`;

  let text = config.agentGreeting;
  try {
    text = await generateCompletion(
      `Incoming call from ${callerNumber}. Greet the caller naturally.`,
      systemPrompt
    );
  } catch (err: any) {
    console.error(`[CALL-CONTROL] AI greeting generation failed: ${err.message}`);
  }

  let audioBuffer: Buffer;
  if (config.voiceSampleId) {
    const sampleAudio = getVoiceSampleAudio(config.voiceSampleId);
    if (sampleAudio) {
      console.log(`[CALL-CONTROL] Voice sample ${config.voiceSampleId} found for user ${config.userId} — using as reference voice`);
    }
  }
  audioBuffer = await textToSpeech(text, config.ttsVoice || "nova", "mp3");

  const call = activeCalls.get(callId);
  if (call) {
    call.conversationHistory.push({
      role: "agent",
      text,
      timestamp: new Date().toISOString(),
    });
    call.audioSegments.set(`turn_0`, audioBuffer);
    call.turnCount = 1;
    call.lastActivityAt = new Date().toISOString();
  }

  return { text, audioBuffer };
}

export async function generateConversationResponse(
  callId: string,
  callerSpeech: string
): Promise<{ text: string; audioBuffer: Buffer } | null> {
  const call = activeCalls.get(callId);
  if (!call) return null;

  call.conversationHistory.push({
    role: "caller",
    text: callerSpeech,
    timestamp: new Date().toISOString(),
  });

  const config = call.numberConfig;
  const conversationContext = call.conversationHistory
    .map((msg) => `${msg.role === "agent" ? config.agentName : "Caller"}: ${msg.text}`)
    .join("\n");

  const systemPrompt = `${config.agentSystemPrompt}

You are ${config.agentName}, on an active phone call for ${config.displayName}.
Caller: ${call.callerNumber}

Conversation so far:
${conversationContext}

CRITICAL RULES FOR PHONE CALLS:
- This will be converted to speech and played to the caller
- Keep responses SHORT — 1 to 3 sentences
- Do NOT use markdown, bullet points, asterisks, or any formatting
- Do NOT use abbreviations or special characters
- Speak naturally as if on the phone
- Be helpful and professional
- If the caller wants to leave a message, acknowledge it
- If you cannot help, offer to take a message or suggest calling back`;

  let text: string;
  try {
    text = await generateCompletion(
      `The caller just said: "${callerSpeech}". Respond naturally.`,
      systemPrompt
    );
  } catch (err: any) {
    console.error(`[CALL-CONTROL] AI response generation failed: ${err.message}`);
    text = "I'm sorry, I'm having a brief technical issue. Could you please repeat that?";
  }

  const audioBuffer = await textToSpeech(text, config.ttsVoice || "nova", "mp3");

  call.conversationHistory.push({
    role: "agent",
    text,
    timestamp: new Date().toISOString(),
  });
  const turnKey = `turn_${call.turnCount}`;
  call.audioSegments.set(turnKey, audioBuffer);
  call.turnCount++;
  call.lastActivityAt = new Date().toISOString();

  return { text, audioBuffer };
}

export function getCallAudioSegment(callId: string, turn: number): Buffer | null {
  const call = activeCalls.get(callId);
  if (!call) return null;
  return call.audioSegments.get(`turn_${turn}`) || null;
}

export function buildTwiMLAnswer(
  audioUrl: string,
  gatherUrl: string,
  callId: string,
  options?: {
    timeout?: number;
    speechTimeout?: string;
    language?: string;
    maxTurns?: number;
    currentTurn?: number;
  }
): string {
  const timeout = options?.timeout || 5;
  const speechTimeout = options?.speechTimeout || "auto";
  const language = options?.language || "en-GB";
  const maxTurns = options?.maxTurns || 10;
  const currentTurn = options?.currentTurn || 0;

  if (currentTurn >= maxTurns) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Say voice="alice">Thank you for calling. Goodbye.</Say>
  <Hangup/>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather input="speech" timeout="${timeout}" speechTimeout="${speechTimeout}" language="${language}" action="${gatherUrl}" method="POST">
    <Say voice="alice"> </Say>
  </Gather>
  <Say voice="alice">I didn't catch that. If you'd like to speak to someone, please call back during business hours. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

export function buildTwiMLPlay(audioUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
</Response>`;
}

export function buildTwiMLSay(text: string, voice: string = "alice"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(text)}</Say>
</Response>`;
}

export function buildTwiMLGather(
  audioUrl: string,
  actionUrl: string,
  options?: { timeout?: number; speechTimeout?: string; language?: string }
): string {
  const timeout = options?.timeout || 5;
  const speechTimeout = options?.speechTimeout || "auto";
  const language = options?.language || "en-GB";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="${timeout}" speechTimeout="${speechTimeout}" language="${language}" action="${actionUrl}" method="POST">
    <Play>${audioUrl}</Play>
  </Gather>
  <Say voice="alice">Thank you for calling. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

export interface CallControlResponse {
  format: "twiml" | "json" | "text" | "audio";
  callId: string;
  text: string;
  audioUrl: string;
  twiml?: string;
  json?: Record<string, any>;
  gatherUrl?: string;
  statusCallbackUrl?: string;
}

export function buildCallControlResponse(
  baseUrl: string,
  callId: string,
  text: string,
  turn: number = 0,
  responseFormat: "twiml" | "json" | "text" | "auto" = "auto"
): CallControlResponse {
  const audioUrl = `${baseUrl}/api/webhook/switchboard/call/${callId}/audio/${turn}`;
  const gatherUrl = `${baseUrl}/api/webhook/switchboard/call/${callId}/gather`;
  const statusCallbackUrl = `${baseUrl}/api/webhook/switchboard/call/${callId}/status`;

  const twiml = buildTwiMLAnswer(audioUrl, gatherUrl, callId, { currentTurn: turn });

  return {
    format: responseFormat === "auto" ? "twiml" : responseFormat,
    callId,
    text,
    audioUrl,
    twiml,
    gatherUrl,
    statusCallbackUrl,
    json: {
      action: "answer",
      callId,
      audio: {
        url: audioUrl,
        format: "audio/mpeg",
        text,
      },
      gather: {
        url: gatherUrl,
        method: "POST",
        input: "speech",
        timeout: 5,
        language: "en-GB",
      },
      statusCallback: statusCallbackUrl,
      turn,
    },
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getCallSummary(callId: string): {
  callId: string;
  duration: number;
  turns: number;
  conversation: Array<{ role: string; text: string; timestamp: string }>;
  status: string;
} | null {
  const call = activeCalls.get(callId);
  if (!call) return null;

  const duration = Math.floor(
    (Date.now() - new Date(call.startedAt).getTime()) / 1000
  );

  return {
    callId: call.id,
    duration,
    turns: call.turnCount,
    conversation: call.conversationHistory,
    status: call.status,
  };
}
