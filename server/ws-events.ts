import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

export interface PhoneEvent {
  type: "call_incoming" | "call_answered" | "call_ended" | "call_missed" | "status_change" | "ai_response" | "tts_ready" | "error";
  userId: string;
  data: any;
  timestamp: string;
}

const clients = new Map<string, Set<WebSocket>>();

let wss: WebSocketServer | null = null;

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws/phone" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", `http://localhost`);
    const userId = url.searchParams.get("userId") || "anonymous";

    if (!clients.has(userId)) {
      clients.set(userId, new Set());
    }
    clients.get(userId)!.add(ws);
    console.log(`[WS] Client connected for user ${userId} (${clients.get(userId)!.size} total)`);

    ws.send(JSON.stringify({
      type: "connected",
      userId,
      timestamp: new Date().toISOString(),
    }));

    ws.on("close", () => {
      const userClients = clients.get(userId);
      if (userClients) {
        userClients.delete(ws);
        if (userClients.size === 0) {
          clients.delete(userId);
        }
      }
      console.log(`[WS] Client disconnected for user ${userId}`);
    });

    ws.on("error", () => {
      const userClients = clients.get(userId);
      if (userClients) {
        userClients.delete(ws);
      }
    });
  });

  console.log("[WS] WebSocket server ready on /ws/phone");
}

export function broadcastToUser(userId: string, event: PhoneEvent) {
  const userClients = clients.get(userId);
  if (!userClients || userClients.size === 0) return;

  const message = JSON.stringify(event);
  for (const ws of userClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch {}
    }
  }
}

export function broadcastToAll(event: PhoneEvent) {
  if (!wss) return;
  const message = JSON.stringify(event);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch {}
    }
  });
}

export function getConnectedClientCount(): number {
  let total = 0;
  for (const userClients of clients.values()) {
    total += userClients.size;
  }
  return total;
}
