const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

export interface AgentWidget {
  id: string;
  userId: string;
  name: string;
  voiceId: string;
  agentId: string;
  systemPrompt: string;
  greeting: string;
  createdAt: string;
}

export interface CallSession {
  id: string;
  widgetId: string;
  userId: string;
  startedAt: number;
  endedAt?: number;
  creditsUsed: number;
  durationMinutes: number;
}

const widgets = new Map<string, AgentWidget>();
const callSessions = new Map<string, CallSession>();

function generateId(prefix: string): string {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY environment variable is not configured");
  }
  return key;
}

export async function createAgentWidget(
  userId: string,
  name: string,
  voiceId: string,
  systemPrompt: string,
  greeting: string
): Promise<AgentWidget> {
  const apiKey = getApiKey();

  const response = await fetch(`${ELEVENLABS_API_BASE}/convai/agents/create`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      conversation_config: {
        agent: {
          prompt: { prompt: systemPrompt },
          first_message: greeting,
          language: "en",
        },
        tts: {
          voice_id: voiceId,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs agent creation failed (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as { agent_id: string };

  const widget: AgentWidget = {
    id: generateId("aw"),
    userId,
    name,
    voiceId,
    agentId: data.agent_id,
    systemPrompt,
    greeting,
    createdAt: new Date().toISOString(),
  };

  widgets.set(widget.id, widget);
  return widget;
}

export async function listWidgets(userId: string): Promise<AgentWidget[]> {
  const result: AgentWidget[] = [];
  const allWidgets = Array.from(widgets.values());
  for (const widget of allWidgets) {
    if (widget.userId === userId) {
      result.push(widget);
    }
  }
  return result;
}

export async function deleteWidget(userId: string, widgetId: string): Promise<boolean> {
  const widget = widgets.get(widgetId);
  if (!widget || widget.userId !== userId) return false;
  widgets.delete(widgetId);
  return true;
}

export async function startCallSession(widgetId: string, userId: string): Promise<CallSession> {
  const widget = widgets.get(widgetId);
  if (!widget) {
    throw new Error("Widget not found");
  }

  const existing = await getActiveSession(widgetId);
  if (existing) {
    throw new Error("There is already an active call session for this widget");
  }

  const session: CallSession = {
    id: generateId("cs"),
    widgetId,
    userId,
    startedAt: Date.now(),
    creditsUsed: 10,
    durationMinutes: 0,
  };

  callSessions.set(session.id, session);

  setTimeout(async () => {
    const s = callSessions.get(session.id);
    if (s && !s.endedAt) {
      s.endedAt = Date.now();
      s.durationMinutes = 60;
      s.creditsUsed = 10 + 5;
      console.log(`[ELEVENLABS-AGENTS] Auto-ended session ${session.id} after 60 minutes`);
    }
  }, 60 * 60 * 1000);

  return session;
}

export async function endCallSession(sessionId: string): Promise<{ session: CallSession; refundedCredits: number }> {
  const session = callSessions.get(sessionId);
  if (!session) {
    throw new Error("Call session not found");
  }
  if (session.endedAt) {
    throw new Error("Call session already ended");
  }

  session.endedAt = Date.now();
  const durationMs = session.endedAt - session.startedAt;
  const durationMinutes = Math.ceil(durationMs / (60 * 1000));
  session.durationMinutes = Math.min(durationMinutes, 60);

  const extraBlocks = session.durationMinutes > 10
    ? Math.ceil((session.durationMinutes - 10) / 10)
    : 0;
  session.creditsUsed = 10 + extraBlocks;

  return { session, refundedCredits: 0 };
}

export async function getActiveSession(widgetId: string): Promise<CallSession | null> {
  const allSessions = Array.from(callSessions.values());
  for (const session of allSessions) {
    if (session.widgetId === widgetId && !session.endedAt) {
      return session;
    }
  }
  return null;
}
