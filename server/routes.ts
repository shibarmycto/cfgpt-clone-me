import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { registerAuthRoutes } from "./auth-routes";
import { sipService, SipService, type SipConfigServer } from "./sip-service";
import {
  streamChat,
  generateCompletion,
  generateImage,
  generateVideoFromText,
  getProviders,
  updateProvider,
  setActiveProvider,
  getActiveProvider,
  addProvider,
  removeProvider,
  getImageGenConfig,
  updateImageGenConfig,
  getVideoGenConfig,
  updateVideoGenConfig,
  getChatProviders,
  getProviderFallbackOrder,
  type AiProviderConfig,
} from "./ai-providers";
import { getMascotSystemPrompt, PERSONALITY_META, PersonalityId } from "./mascot-chat";
import { createOrder, captureOrder, getPackages } from "./paypal";
import { getVideoAdStatus, recordVideoAdWatch } from "./video-ad-rewards";
import { getLinkClickStatus, recordLinkClick } from "./link-rewards";
import { cloneVoice, listVoices, deleteVoice, textToSpeech as elTextToSpeech } from "./elevenlabs";
import { createAgentWidget, listWidgets, deleteWidget, startCallSession, endCallSession, getActiveSession } from "./elevenlabs-agents";
import {
  generateTrunk,
  getTrunk,
  updateTrunkConfig,
  regenerateTrunk,
  revokeTrunk,
} from "./sip-credentials";
import {
  createVirtualNumber,
  getVirtualNumbers,
  getAllVirtualNumbers,
  getVirtualNumber,
  updateVirtualNumber,
  deleteVirtualNumber,
  handleIncomingWebhook,
  getCallHistory,
  clearCallHistory,
  testAgentResponse,
  getBillingStatus,
  markBilled,
  getWebhookLog,
  getRegisteredNumberCount,
  getCachedTTS,
  cacheTTS,
} from "./virtual-numbers";
import {
  uploadVoiceSample,
  getUserVoiceSamples,
  getVoiceSample,
  getActiveVoiceSample,
  setActiveVoiceSample,
  deleteVoiceSample,
  getVoiceSampleAudio,
} from "./voice-storage";
import { textToSpeech } from "./replit_integrations/audio/client";
import {
  createActiveCall,
  getActiveCall,
  endCall,
  getActiveCallCount,
  generateGreetingAudio,
  generateConversationResponse,
  getCallAudioSegment,
  buildCallControlResponse,
  buildTwiMLAnswer,
  buildTwiMLGather,
  getCallSummary,
} from "./call-control";
import {
  connectWebPhone,
  disconnectWebPhone,
  getWebPhoneStatus,
  getWebPhoneCallLog,
  getWebPhoneLogs,
  updateWebPhoneSettings,
  clearWebPhoneCallLog,
  getActiveWebPhoneCount,
  getAllWebPhoneSessions,
} from "./web-phone";
import {
  createProject,
  getProjects,
  getProject,
  getProjectBySlug,
  updateProjectFiles,
  deleteProject,
  addMessageToProject,
  streamBuildAgent,
  parseFilesFromResponse,
  deployProject,
  createDomainRequest,
  getDomainRequests,
  updateDomainRequest,
  createSupportMessage,
  getSupportMessages,
  updateSupportMessage,
  getAdminNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  addAdminNotification,
  setGithubToken,
  getGithubToken,
  removeGithubToken,
  pushToGithub,
} from "./build-agent";
import {
  createVirtualMac,
  getUserDevices,
  updateDeviceName,
  regenerateDeviceMac,
  linkDeviceToSip,
  deleteDevice,
  getDevice,
} from "./virtual-mac";
import { searchAvailableNumbers, orderNumber, listOwnedNumbers } from "./telnyx";

const GUEST_MESSAGE_LIMIT = 5;
const guestUsageTracker = new Map<string, { count: number; firstSeen: number }>();

setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  for (const [key, val] of guestUsageTracker) {
    if (now - val.firstSeen > maxAge) {
      guestUsageTracker.delete(key);
    }
  }
}, 60 * 60 * 1000);

let savedReceptionistConfig: {
  greeting: string;
  systemPrompt: string;
  companyName: string;
  name: string;
} | null = null;

sipService.setCallHandler(async (callerNumber, calledNumber, callId, routedSipUser) => {
  const greeting =
    savedReceptionistConfig?.greeting ||
    "Thank you for calling. How may I help you?";
  const systemPrompt =
    savedReceptionistConfig?.systemPrompt ||
    "You are a professional AI receptionist. Be helpful, concise, and courteous.";
  const companyName =
    savedReceptionistConfig?.companyName || "our company";
  const name = savedReceptionistConfig?.name || "AI Assistant";

  const routeInfo = routedSipUser
    ? `This call was routed via phone route to SIP user ${routedSipUser}. `
    : "";

  try {
    const response = await generateCompletion(
      `${routeInfo}An incoming phone call from ${callerNumber} to ${calledNumber}. Generate a professional greeting response as ${name} from ${companyName}. The greeting should be: "${greeting}". Keep it under 200 words, conversational and warm.`,
      systemPrompt
    );
    return response;
  } catch {
    return greeting;
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  app.use((req: Request, res: Response, next: Function) => {
    const host = req.headers.host || "";
    const match = host.match(/^([a-z0-9-]+)\.cfgpt\.org$/i);
    if (match) {
      const slug = match[1];
      if (slug === "www" || slug === "api" || slug === "app") return next();
      const project = getProjectBySlug(slug);
      if (project) {
        const urlPath = req.path === "/" ? "" : req.path.replace(/^\//, "");
        const file = urlPath || "index.html";
        const content = project.files[file];
        if (!content && file === "index.html") {
          const fileList = Object.keys(project.files);
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${project.name}</title></head><body style="background:#0d1117;color:#fff;font-family:sans-serif;padding:40px"><h1>${project.name}</h1><p>Files:</p><ul>${fileList.map(f => `<li><a href="/${f}" style="color:#58a6ff">${f}</a></li>`).join("")}</ul></body></html>`;
          return res.type("text/html").send(html);
        }
        if (!content) return res.status(404).send("File not found");
        const ext = file.split(".").pop()?.toLowerCase() || "";
        const mimes: Record<string, string> = { html: "text/html", css: "text/css", js: "application/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", ico: "image/x-icon" };
        res.type(mimes[ext] || "text/plain").send(content);
        return;
      }
    }
    next();
  });

  registerAuthRoutes(app);

  app.post("/api/chat", async (req: Request, res: Response) => {
    try {
      const { messages, systemPrompt, providerId } = req.body;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const stream = await streamChat(
        messages,
        systemPrompt ||
          "You are CFGPT, a highly capable AI assistant. You help users with questions, tasks, and conversation. Be concise, helpful, and professional.",
        providerId
      );

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Chat error:", error);
      if (res.headersSent) {
        res.write(
          `data: ${JSON.stringify({ error: error.message || "An error occurred" })}\n\n`
        );
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process chat" });
      }
    }
  });

  app.get("/api/chat/providers", (_req: Request, res: Response) => {
    const providers = getChatProviders();
    const fallbackOrder = getProviderFallbackOrder();
    res.json({ providers, fallbackOrder });
  });

  app.get("/api/mascot-personalities", (_req: Request, res: Response) => {
    res.json(Object.values(PERSONALITY_META));
  });

  app.post("/api/guest-usage", (req: Request, res: Response) => {
    const { deviceId } = req.body;
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    const trackingId = deviceId || clientIp;

    const usage = guestUsageTracker.get(trackingId) || { count: 0, firstSeen: Date.now() };
    const ipUsage = guestUsageTracker.get(`ip:${clientIp}`) || { count: 0, firstSeen: Date.now() };
    const effectiveCount = Math.max(usage.count, ipUsage.count);

    res.json({
      used: effectiveCount,
      limit: GUEST_MESSAGE_LIMIT,
      remaining: Math.max(0, GUEST_MESSAGE_LIMIT - effectiveCount),
    });
  });

  app.post("/api/mascot-chat", async (req: Request, res: Response) => {
    try {
      const { messages, userId, personality, deviceId } = req.body;

      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const trackingId = deviceId || userId || clientIp;
      const isGuestUser = !userId || userId === "guest" || userId.startsWith("guest-");

      if (isGuestUser) {
        const usage = guestUsageTracker.get(trackingId) || { count: 0, firstSeen: Date.now() };
        const ipUsage = guestUsageTracker.get(`ip:${clientIp}`) || { count: 0, firstSeen: Date.now() };
        const effectiveCount = Math.max(usage.count, ipUsage.count);

        if (effectiveCount >= GUEST_MESSAGE_LIMIT) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders();
          res.write(`data: ${JSON.stringify({ content: "You've used all 5 free messages! Sign up to continue chatting with the CF crew and unlock unlimited conversations, credits, and exclusive features. Tap the menu to create your account - it only takes a sec!", limitReached: true })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        usage.count = effectiveCount + 1;
        usage.firstSeen = usage.firstSeen || Date.now();
        guestUsageTracker.set(trackingId, usage);

        const ipEntry = { count: effectiveCount + 1, firstSeen: ipUsage.firstSeen || Date.now() };
        guestUsageTracker.set(`ip:${clientIp}`, ipEntry);
      }

      const sessionId = userId || clientIp;
      const validPersonality: PersonalityId = ["urban", "trader", "eliza"].includes(personality) ? personality : "urban";
      const systemPrompt = getMascotSystemPrompt(sessionId, messages || [], validPersonality);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const fallbackOrder = getProviderFallbackOrder();
      let lastError: any = null;
      let streamed = false;

      for (const providerId of fallbackOrder) {
        try {
          const stream = await streamChat(
            messages || [],
            systemPrompt,
            providerId
          );

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
              streamed = true;
            }
          }

          res.write("data: [DONE]\n\n");
          res.end();
          return;
        } catch (err: any) {
          console.error(`Mascot chat provider ${providerId} failed:`, err.message);
          lastError = err;
        }
      }

      if (!streamed) {
        res.write(`data: ${JSON.stringify({ content: "CF is having a moment... try again in a sec fam!", error: true })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Mascot chat error:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ content: "Something went wrong, try again!", error: true })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.status(500).json({ error: "CF is offline rn, try again in a sec" });
      }
    }
  });

  app.post("/api/sip/register", async (req: Request, res: Response) => {
    try {
      const config: SipConfigServer = req.body;

      if (!config.domain || !config.username) {
        return res
          .status(400)
          .json({ error: "Domain and username are required" });
      }

      sipService.register(config).then((success) => {
        const status = sipService.getStatus();
        console.log(`SIP registration ${success ? "succeeded" : "failed"}: ${status.error || "OK"}`);
      }).catch((err) => {
        console.error("SIP registration error:", err);
      });

      res.json({
        success: true,
        status: { ...sipService.getStatus(), registering: true },
        message: "SIP registration started. Check status for updates.",
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "SIP registration failed" });
    }
  });

  app.post("/api/sip/unregister", async (_req: Request, res: Response) => {
    try {
      await sipService.unregister();
      res.json({
        success: true,
        status: sipService.getStatus(),
        message: "Disconnected from SIP server",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sip/status", (_req: Request, res: Response) => {
    res.json(sipService.getStatus());
  });

  app.get("/api/sip/logs", (_req: Request, res: Response) => {
    res.json(sipService.getLogs());
  });

  app.post("/api/sip/test", async (req: Request, res: Response) => {
    try {
      const config: SipConfigServer = req.body;
      if (!config.domain || !config.username) {
        return res.status(400).json({ error: "Domain and username are required" });
      }

      const testService = new SipService();
      const testLogs: string[] = [];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const logInterval = setInterval(() => {
        const logs = testService.getLogs();
        if (logs.length > testLogs.length) {
          const newLogs = logs.slice(testLogs.length);
          for (const log of newLogs) {
            res.write(`data: ${JSON.stringify({ log })}\n\n`);
          }
          testLogs.push(...newLogs);
        }
      }, 200);

      res.write(`data: ${JSON.stringify({ log: `Testing SIP connection to ${config.domain}:${config.port}...` })}\n\n`);

      const success = await testService.register(config);
      const status = testService.getStatus();

      clearInterval(logInterval);

      const finalLogs = testService.getLogs();
      if (finalLogs.length > testLogs.length) {
        for (const log of finalLogs.slice(testLogs.length)) {
          res.write(`data: ${JSON.stringify({ log })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ result: { success, status } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();

      try { await testService.unregister(); } catch {}
    } catch (error: any) {
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  app.post("/api/sip/phone-routes", (req: Request, res: Response) => {
    try {
      const { routes } = req.body;
      if (!routes || typeof routes !== "object") {
        return res.status(400).json({ error: "Routes object is required" });
      }
      for (const [phoneNumber, sipUser] of Object.entries(routes)) {
        if (typeof sipUser === "string" && sipUser.length > 0) {
          sipService.setPhoneRoute(phoneNumber, sipUser);
        } else {
          sipService.removePhoneRoute(phoneNumber);
        }
      }
      res.json({ success: true, routes: sipService.getPhoneRoutes() });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update phone routes" });
    }
  });

  app.get("/api/sip/phone-routes", (_req: Request, res: Response) => {
    res.json(sipService.getPhoneRoutes());
  });

  app.post(
    "/api/receptionist/config",
    async (req: Request, res: Response) => {
      try {
        savedReceptionistConfig = req.body;
        res.json({ success: true, message: "Receptionist config updated" });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    }
  );

  app.get("/api/providers", (_req: Request, res: Response) => {
    res.json(getProviders());
  });

  app.get("/api/providers/active", (_req: Request, res: Response) => {
    const active = getActiveProvider();
    res.json({
      ...active,
      apiKey: active.apiKey ? "***configured***" : "",
    });
  });

  app.post("/api/providers", (req: Request, res: Response) => {
    try {
      const config: AiProviderConfig = req.body;
      addProvider(config);
      res.json({ success: true, providers: getProviders() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/providers/:id", (req: Request, res: Response) => {
    try {
      const config: AiProviderConfig = { ...req.body, id: req.params.id };
      updateProvider(config);
      res.json({ success: true, providers: getProviders() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/providers/:id/activate", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      setActiveProvider(id);
      res.json({ success: true, providers: getProviders() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/providers/:id", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      removeProvider(id);
      res.json({ success: true, providers: getProviders() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/providers/test", async (req: Request, res: Response) => {
    try {
      const { providerId } = req.body;
      const response = await generateCompletion(
        "Say hello in exactly 5 words.",
        "You are a test assistant. Be very brief.",
        providerId
      );
      res.json({ success: true, response });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Provider test failed",
      });
    }
  });

  app.get("/api/ai/image-config", (_req: Request, res: Response) => {
    res.json(getImageGenConfig());
  });

  app.put("/api/ai/image-config", (req: Request, res: Response) => {
    try {
      updateImageGenConfig(req.body);
      res.json({ success: true, config: getImageGenConfig() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ai/video-config", (_req: Request, res: Response) => {
    res.json(getVideoGenConfig());
  });

  app.put("/api/ai/video-config", (req: Request, res: Response) => {
    try {
      updateVideoGenConfig(req.body);
      res.json({ success: true, config: getVideoGenConfig() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/generate-image", async (req: Request, res: Response) => {
    try {
      const { prompt, size } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const result = await generateImage(prompt, size || "1024x1024");
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true, image: result.b64, url: result.url });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Image generation failed" });
    }
  });

  app.post("/api/ai/generate-video", async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const result = await generateVideoFromText(prompt);
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true, url: result.url, b64: result.b64, videoUrl: result.videoUrl, storyboard: result.storyboard });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Video generation failed" });
    }
  });

  app.post("/api/ai/agent", async (req: Request, res: Response) => {
    try {
      const { prompt, context } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const systemPrompt = `You are Agent Kimi, an advanced AI coding assistant. You help users write, edit, and debug code. You can generate complete files, refactor code, and provide detailed technical explanations. ${context ? `Context: ${context}` : ""}`;

      const stream = await streamChat(
        [{ role: "user", content: prompt }],
        systemPrompt
      );

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: error.message || "Agent error" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Agent processing failed" });
      }
    }
  });

  app.get("/api/paypal/packages", (_req: Request, res: Response) => {
    res.json(getPackages());
  });

  app.post("/api/paypal/create-order", async (req: Request, res: Response) => {
    try {
      const { packageId } = req.body;
      if (!packageId) {
        return res.status(400).json({ error: "Package ID is required" });
      }

      const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
      const forwardedHost = req.header("x-forwarded-host") || req.get("host");
      const baseUrl = `${forwardedProto}://${forwardedHost}`;

      const returnUrl = `${baseUrl}/api/paypal/success?packageId=${packageId}`;
      const cancelUrl = `${baseUrl}/api/paypal/cancel`;

      const order = await createOrder(packageId, returnUrl, cancelUrl);
      res.json(order);
    } catch (error: any) {
      console.error("PayPal create order error:", error);
      res.status(500).json({ error: error.message || "Failed to create PayPal order" });
    }
  });

  app.get("/api/paypal/success", async (req: Request, res: Response) => {
    try {
      const { token, packageId } = req.query;
      if (!token) {
        return res.status(400).send("Missing order token");
      }

      const result = await captureOrder(token as string);

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Successful</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0A0E1A;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#1E293B;border-radius:20px;padding:48px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4)}
  .icon{font-size:64px;margin-bottom:16px}
  h1{color:#00D4AA;margin:0 0 8px;font-size:28px}
  p{color:#94A3B8;margin:0 0 24px;font-size:16px;line-height:1.6}
  .credits{font-size:48px;font-weight:800;background:linear-gradient(135deg,#00D4AA,#3B82F6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:16px 0}
  .btn{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#00D4AA,#3B82F6);color:#fff;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px;transition:transform 0.2s}
  .btn:hover{transform:scale(1.05)}
  .txn{color:#475569;font-size:12px;margin-top:24px}
</style>
<script>
  window.addEventListener('load', function() {
    try {
      const data = ${JSON.stringify({ success: true, credits: result.credits, packageId: result.packageId, transactionId: result.transactionId })};
      if (window.opener) {
        window.opener.postMessage({ type: 'PAYPAL_SUCCESS', ...data }, '*');
      }
      localStorage.setItem('cfgpt_last_payment', JSON.stringify(data));
    } catch(e) {}
  });
</script>
</head><body>
<div class="card">
  <div class="icon">&#10003;</div>
  <h1>Payment Successful!</h1>
  <p>Your credits have been added to your account</p>
  <div class="credits">${result.credits}</div>
  <p>credits added</p>
  <a class="btn" href="/(tabs)">Return to App</a>
  <div class="txn">Transaction: ${result.transactionId}</div>
</div>
</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error: any) {
      console.error("PayPal capture error:", error);
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Error</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0A0E1A;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#1E293B;border-radius:20px;padding:48px;max-width:420px;text-align:center}
  h1{color:#EF4444;margin:0 0 12px}
  p{color:#94A3B8;margin:0 0 24px}
  .btn{display:inline-block;padding:14px 32px;background:#334155;color:#fff;text-decoration:none;border-radius:12px;font-weight:600}
</style></head><body>
<div class="card">
  <h1>Payment Issue</h1>
  <p>${error.message || "Something went wrong processing your payment. Please try again."}</p>
  <a class="btn" href="/(tabs)">Return to App</a>
</div>
</body></html>`;
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    }
  });

  app.get("/api/paypal/cancel", (_req: Request, res: Response) => {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Cancelled</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0A0E1A;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#1E293B;border-radius:20px;padding:48px;max-width:420px;text-align:center}
  h1{color:#F59E0B;margin:0 0 12px}
  p{color:#94A3B8;margin:0 0 24px}
  .btn{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#00D4AA,#3B82F6);color:#fff;text-decoration:none;border-radius:12px;font-weight:600}
</style>
<script>
  window.addEventListener('load', function() {
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'PAYPAL_CANCEL' }, '*');
      }
    } catch(e) {}
  });
</script>
</head><body>
<div class="card">
  <h1>Payment Cancelled</h1>
  <p>No charges were made. You can try again anytime.</p>
  <a class="btn" href="/(tabs)">Return to App</a>
</div>
</body></html>`;
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  app.post("/api/earn/watch-video", (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const result = recordVideoAdWatch(userId);
      if (!result.success) {
        return res.status(result.cooldownMs ? 429 : 400).json(result);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record video watch" });
    }
  });

  app.get("/api/earn/status", (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      res.json(getVideoAdStatus(userId));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get earn status" });
    }
  });

  app.get("/api/earn/link-status", (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      res.json(getLinkClickStatus(userId));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get link status" });
    }
  });

  app.post("/api/earn/link-click", (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const result = recordLinkClick(userId);
      if (!result.success) {
        return res.status(result.cooldownMs ? 429 : 400).json(result);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record link click" });
    }
  });

  app.post("/api/sip-trunk/generate", (req: Request, res: Response) => {
    try {
      const { userId, phoneNumber } = req.body;
      if (!userId || !phoneNumber) {
        return res.status(400).json({ error: "User ID and phone number are required" });
      }
      const trunk = generateTrunk(userId, phoneNumber);
      res.json({ success: true, trunk });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate SIP trunk" });
    }
  });

  app.get("/api/sip-trunk", (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const trunk = getTrunk(userId);
      res.json({ trunk: trunk || null });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch SIP trunk" });
    }
  });

  app.put("/api/sip-trunk/config", (req: Request, res: Response) => {
    try {
      const { userId, ...updates } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const trunk = updateTrunkConfig(userId, updates);
      if (!trunk) {
        return res.status(404).json({ error: "No SIP trunk found. Generate one first." });
      }
      res.json({ success: true, trunk });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update trunk config" });
    }
  });

  app.post("/api/sip-trunk/regenerate", (req: Request, res: Response) => {
    try {
      const { userId, phoneNumber } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const trunk = regenerateTrunk(userId, phoneNumber || "");
      res.json({ success: true, trunk });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to regenerate SIP trunk" });
    }
  });

  app.post("/api/sip-trunk/revoke", (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const revoked = revokeTrunk(userId);
      res.json({ success: true, revoked });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to revoke SIP trunk" });
    }
  });

  // ======= VOICE SAMPLES =======

  app.post("/api/voice-samples/upload", (req: Request, res: Response) => {
    try {
      const { userId, name, audio, mimeType } = req.body;
      if (!userId || !name || !audio || !mimeType) {
        return res.status(400).json({ error: "userId, name, audio (base64), and mimeType are required" });
      }
      const sample = uploadVoiceSample(userId, name, audio, mimeType);
      res.json({
        id: sample.id,
        name: sample.name,
        url: `/api/voice-samples/${sample.id}/audio`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to upload voice sample" });
    }
  });

  app.get("/api/voice-samples", (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "userId query parameter is required" });
      }
      const samples = getUserVoiceSamples(userId).map((s) => ({
        id: s.id,
        userId: s.userId,
        name: s.name,
        mimeType: s.mimeType,
        duration: s.duration,
        createdAt: s.createdAt,
        isActive: s.isActive,
        url: `/api/voice-samples/${s.id}/audio`,
      }));
      res.json(samples);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get voice samples" });
    }
  });

  app.get("/api/voice-samples/:id/audio", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const audio = getVoiceSampleAudio(id);
      if (!audio) {
        return res.status(404).json({ error: "Voice sample not found" });
      }
      res.setHeader("Content-Type", audio.mimeType);
      res.setHeader("Content-Length", audio.buffer.length.toString());
      res.send(audio.buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get voice sample audio" });
    }
  });

  app.put("/api/voice-samples/:id/activate", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const sample = getVoiceSample(id);
      if (!sample) {
        return res.status(404).json({ error: "Voice sample not found" });
      }
      const success = setActiveVoiceSample(sample.userId, sample.id);
      if (!success) {
        return res.status(400).json({ error: "Failed to activate voice sample" });
      }
      res.json({ success: true, id: sample.id, isActive: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to activate voice sample" });
    }
  });

  app.delete("/api/voice-samples/:id", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const deleted = deleteVoiceSample(id);
      if (!deleted) {
        return res.status(404).json({ error: "Voice sample not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete voice sample" });
    }
  });

  // ======= VIRTUAL NUMBERS & SWITCHBOARD FREE WEBHOOK =======

  // ======= CALL CONTROL WEBHOOK — Answers calls with AI voice =======

  async function handleCallWebhook(req: Request, res: Response, method: string) {
    try {
      console.log(`[CALL-CONTROL] ${method} webhook request from: ${req.ip}`);
      const payload = method === "POST" ? { ...req.body, ...req.query } : req.query;
      const result = await handleIncomingWebhook(payload as any, method);

      const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
      const forwardedHost = req.header("x-forwarded-host") || req.get("host") || "cfgpt.org";
      const baseUrl = `${forwardedProto}://${forwardedHost}`;

      const responseFormat = (req.query.format as string) || (req.headers.accept?.includes("xml") ? "twiml" : "auto");

      if (!result.numberConfig) {
        if (responseFormat === "twiml" || responseFormat === "auto") {
          res.setHeader("Content-Type", "application/xml");
          res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${result.response.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Say>
  <Hangup/>
</Response>`);
        } else {
          res.setHeader("Content-Type", "application/json");
          res.json({
            action: "say",
            text: result.response,
            callId: result.callId,
            hangup: true,
          });
        }
        return;
      }

      const call = createActiveCall(
        payload.cli || payload.callerNumber || payload.from || "Unknown",
        payload.ddi || payload.calledNumber || payload.to || "",
        result.numberConfig,
        result.callId
      );

      console.log(`[CALL-CONTROL] Generating greeting audio for call ${call.id}...`);
      const { text, audioBuffer } = await generateGreetingAudio(
        result.numberConfig,
        call.callerNumber,
        call.id
      );

      cacheTTS(call.id, audioBuffer);
      call.audioSegments.set("turn_0", audioBuffer);

      const controlResponse = buildCallControlResponse(baseUrl, call.id, text, 0, responseFormat as any);

      res.setHeader("X-CFGPT-Call-Id", call.id);
      res.setHeader("X-CFGPT-Audio-Url", controlResponse.audioUrl);

      if (responseFormat === "twiml" || responseFormat === "auto") {
        res.setHeader("Content-Type", "application/xml");
        res.send(controlResponse.twiml);
        console.log(`[CALL-CONTROL] Sent TwiML response for call ${call.id}`);
      } else if (responseFormat === "json") {
        res.setHeader("Content-Type", "application/json");
        res.json(controlResponse.json);
        console.log(`[CALL-CONTROL] Sent JSON response for call ${call.id}`);
      } else {
        res.setHeader("Content-Type", "text/plain");
        res.send(text);
        console.log(`[CALL-CONTROL] Sent text response for call ${call.id}`);
      }
    } catch (error: any) {
      console.error("[CALL-CONTROL] Webhook error:", error);
      res.setHeader("Content-Type", "application/xml");
      res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling. We're experiencing a brief issue. Please try again shortly.</Say>
  <Hangup/>
</Response>`);
    }
  }

  app.get("/api/webhook/switchboard", (req, res) => handleCallWebhook(req, res, "GET"));
  app.post("/api/webhook/switchboard", (req, res) => handleCallWebhook(req, res, "POST"));

  // Conversation continuation — called after caller speaks (Gather callback)
  app.post("/api/webhook/switchboard/call/:callId/gather", async (req: Request, res: Response) => {
    try {
      const callId = Array.isArray(req.params.callId) ? req.params.callId[0] : req.params.callId;
      const callerSpeech = req.body.SpeechResult || req.body.speechResult || req.body.speech || req.body.text || "";

      console.log(`[CALL-CONTROL] Gather received for call ${callId}: "${callerSpeech}"`);

      const call = getActiveCall(callId);
      if (!call) {
        res.setHeader("Content-Type", "application/xml");
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I'm sorry, this call session has expired. Please call back. Goodbye.</Say>
  <Hangup/>
</Response>`);
        return;
      }

      if (!callerSpeech || callerSpeech.trim() === "") {
        const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
        const forwardedHost = req.header("x-forwarded-host") || req.get("host") || "cfgpt.org";
        const baseUrl = `${forwardedProto}://${forwardedHost}`;
        const gatherUrl = `${baseUrl}/api/webhook/switchboard/call/${callId}/gather`;

        res.setHeader("Content-Type", "application/xml");
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I'm still here. Go ahead.</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" language="en-GB" action="${gatherUrl}" method="POST">
    <Say voice="alice"> </Say>
  </Gather>
  <Say voice="alice">I didn't hear anything. Goodbye.</Say>
  <Hangup/>
</Response>`);
        return;
      }

      const result = await generateConversationResponse(callId, callerSpeech);
      if (!result) {
        res.setHeader("Content-Type", "application/xml");
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I'm sorry, I'm having trouble. Please try calling back. Goodbye.</Say>
  <Hangup/>
</Response>`);
        return;
      }

      const turn = call.turnCount - 1;
      call.audioSegments.set(`turn_${turn}`, result.audioBuffer);
      cacheTTS(`${callId}_turn_${turn}`, result.audioBuffer);

      const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
      const forwardedHost = req.header("x-forwarded-host") || req.get("host") || "cfgpt.org";
      const baseUrl = `${forwardedProto}://${forwardedHost}`;

      const audioUrl = `${baseUrl}/api/webhook/switchboard/call/${callId}/audio/${turn}`;
      const gatherUrl = `${baseUrl}/api/webhook/switchboard/call/${callId}/gather`;

      const twiml = buildTwiMLGather(audioUrl, gatherUrl, {
        timeout: 5,
        speechTimeout: "auto",
        language: "en-GB",
      });

      res.setHeader("Content-Type", "application/xml");
      res.setHeader("X-CFGPT-Call-Id", callId);
      res.send(twiml);

      console.log(`[CALL-CONTROL] Sent conversation turn ${turn} for call ${callId}`);
    } catch (error: any) {
      console.error("[CALL-CONTROL] Gather error:", error);
      res.setHeader("Content-Type", "application/xml");
      res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I'm sorry, something went wrong. Goodbye.</Say>
  <Hangup/>
</Response>`);
    }
  });

  // Audio segment for a specific conversation turn
  app.get("/api/webhook/switchboard/call/:callId/audio/:turn", async (req: Request, res: Response) => {
    try {
      const callId = Array.isArray(req.params.callId) ? req.params.callId[0] : req.params.callId;
      const turn = parseInt(Array.isArray(req.params.turn) ? req.params.turn[0] : req.params.turn) || 0;

      const audio = getCallAudioSegment(callId, turn);
      if (audio) {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", audio.length.toString());
        res.setHeader("Cache-Control", "public, max-age=300");
        res.send(audio);
        return;
      }

      const cached = getCachedTTS(`${callId}_turn_${turn}`) || getCachedTTS(callId);
      if (cached) {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", cached.length.toString());
        res.send(cached);
        return;
      }

      res.status(404).json({ error: "Audio not found or expired" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Call status callback
  app.post("/api/webhook/switchboard/call/:callId/status", (req: Request, res: Response) => {
    const callId = Array.isArray(req.params.callId) ? req.params.callId[0] : req.params.callId;
    const callStatus = req.body.CallStatus || req.body.status || req.body.event || "";

    console.log(`[CALL-CONTROL] Status update for call ${callId}: ${callStatus}`);

    if (["completed", "busy", "no-answer", "canceled", "failed"].includes(callStatus)) {
      endCall(callId);
    }

    res.status(200).send("OK");
  });

  // Get call summary/transcript
  app.get("/api/webhook/switchboard/call/:callId/summary", (req: Request, res: Response) => {
    const callId = Array.isArray(req.params.callId) ? req.params.callId[0] : req.params.callId;
    const summary = getCallSummary(callId);
    if (!summary) {
      return res.status(404).json({ error: "Call not found or expired" });
    }
    res.json(summary);
  });

  // Legacy audio endpoint (backward compatible)
  app.get("/api/webhook/switchboard/audio/:callId", async (req: Request, res: Response) => {
    try {
      const callId = Array.isArray(req.params.callId) ? req.params.callId[0] : req.params.callId;

      const audio = getCallAudioSegment(callId, 0);
      if (audio) {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", audio.length.toString());
        res.send(audio);
        return;
      }

      const cached = getCachedTTS(callId);
      if (cached) {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", cached.length.toString());
        res.send(cached);
        return;
      }
      res.status(404).json({ error: "Audio not found or expired" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // TTS endpoint (standalone)
  app.get("/api/webhook/switchboard/tts", async (req: Request, res: Response) => {
    try {
      const text = (req.query.text as string) || "Hello, thank you for calling.";
      const voice = (req.query.voice as any) || "nova";
      const audioBuffer = await textToSpeech(text, voice, "mp3");
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.length.toString());
      res.send(audioBuffer);
    } catch (error: any) {
      console.error("[TTS] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Health check
  app.get("/api/webhook/switchboard/health", (_req: Request, res: Response) => {
    const count = getRegisteredNumberCount();
    const allNums = getAllVirtualNumbers();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      webhook_url: "https://cfgpt.org/api/webhook/switchboard",
      supported_formats: ["twiml", "json", "text"],
      call_control: {
        answer_with_voice: true,
        multi_turn_conversation: true,
        speech_recognition: true,
        tts_voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
        gather_endpoint: "/api/webhook/switchboard/call/{callId}/gather",
        audio_endpoint: "/api/webhook/switchboard/call/{callId}/audio/{turn}",
        status_endpoint: "/api/webhook/switchboard/call/{callId}/status",
        summary_endpoint: "/api/webhook/switchboard/call/{callId}/summary",
      },
      active_calls: getActiveCallCount(),
      registered_numbers: count,
      numbers: allNums.map((n) => ({
        phone: n.phoneNumber,
        name: n.agentName,
        displayName: n.displayName,
        active: n.isActive,
        callsHandled: n.callsHandled,
        lastCallAt: n.lastCallAt,
        userId: n.userId,
      })),
      tts_enabled: true,
      setup_instructions: {
        step1: "Add your phone number in the CFGPT app Numbers tab",
        step2: "Set webhook URL in your provider: https://cfgpt.org/api/webhook/switchboard",
        step3: "For TwiML providers (Twilio, Telnyx): Use GET or POST, webhook returns XML call instructions",
        step4: "For JSON providers: Add ?format=json to webhook URL",
        step5: "The AI will answer calls, generate voice response via TTS, and handle multi-turn conversations",
      },
      setup_required: count === 0 ? "No numbers registered yet. Users must add their own number in the app." : null,
    });
  });

  // Webhook logs
  app.get("/api/webhook/switchboard/logs", (_req: Request, res: Response) => {
    res.json({
      logs: getWebhookLog(),
      registered_numbers: getRegisteredNumberCount(),
      active_calls: getActiveCallCount(),
      numbers: getAllVirtualNumbers(),
    });
  });

  app.get("/api/virtual-numbers", (req: Request, res: Response) => {
    const userId = (req.query.userId as string) || "default";
    res.json(getVirtualNumbers(userId));
  });

  app.post("/api/virtual-numbers", (req: Request, res: Response) => {
    try {
      const { userId, ...data } = req.body;
      if (!data.phoneNumber || !data.sipUsername || !data.sipPassword) {
        return res.status(400).json({ error: "Phone number, SIP username, and SIP password are required" });
      }
      const config = createVirtualNumber(userId || "default", data);
      res.json({ success: true, number: { ...config, sipPassword: "***" } });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create virtual number" });
    }
  });

  app.put("/api/virtual-numbers/:id", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const updated = updateVirtualNumber(id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Virtual number not found" });
      }
      res.json({ success: true, number: { ...updated, sipPassword: "***" } });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update virtual number" });
    }
  });

  app.delete("/api/virtual-numbers/:id", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const deleted = deleteVirtualNumber(id);
      if (!deleted) {
        return res.status(404).json({ error: "Virtual number not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete virtual number" });
    }
  });

  app.get("/api/virtual-numbers/:id/history", (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    res.json(getCallHistory(id));
  });

  app.delete("/api/virtual-numbers/:id/history", (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    clearCallHistory(id);
    res.json({ success: true });
  });

  app.get("/api/virtual-numbers/:id/billing", (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const status = getBillingStatus(id);
    if (!status) {
      return res.status(404).json({ error: "Number not found" });
    }
    res.json(status);
  });

  app.post("/api/virtual-numbers/:id/bill", (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const success = markBilled(id);
    if (!success) {
      return res.status(404).json({ error: "Number not found" });
    }
    res.json({ success: true });
  });

  app.post("/api/virtual-numbers/:id/test", async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { message } = req.body;
      const response = await testAgentResponse(id, message || "Hello, is anyone there?");
      res.json({ success: true, response });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Test failed" });
    }
  });

  // ======= WEB PHONE — Zoiper-style SIP softphone =======

  app.post("/api/web-phone/connect", async (req: Request, res: Response) => {
    try {
      const { userId, sipConfig, aiConfig } = req.body;
      if (!userId || !sipConfig?.server || !sipConfig?.username || !sipConfig?.password) {
        return res.status(400).json({ error: "userId, sipConfig.server, sipConfig.username, and sipConfig.password are required" });
      }
      const result = await connectWebPhone(userId, {
        server: sipConfig.server,
        port: sipConfig.port || 5060,
        username: sipConfig.username,
        authUsername: sipConfig.authUsername || sipConfig.username,
        password: sipConfig.password,
        transport: sipConfig.transport || "TCP",
        phoneNumber: sipConfig.phoneNumber || "",
        displayName: sipConfig.displayName || sipConfig.phoneNumber || sipConfig.username,
      }, aiConfig);
      if (result.success) {
        res.json({ success: true, status: getWebPhoneStatus(userId) });
      } else {
        res.json({ success: false, error: result.error, status: getWebPhoneStatus(userId) });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to connect web phone" });
    }
  });

  app.post("/api/web-phone/disconnect", async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const success = await disconnectWebPhone(userId);
      res.json({ success, status: getWebPhoneStatus(userId) });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to disconnect" });
    }
  });

  app.get("/api/web-phone/status", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    res.json(getWebPhoneStatus(userId));
  });

  app.get("/api/web-phone/call-log", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    res.json(getWebPhoneCallLog(userId));
  });

  app.get("/api/web-phone/logs", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    res.json(getWebPhoneLogs(userId));
  });

  app.put("/api/web-phone/settings", (req: Request, res: Response) => {
    try {
      const { userId, ...settings } = req.body;
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const success = updateWebPhoneSettings(userId, settings);
      if (!success) return res.status(404).json({ error: "No active phone session. Connect first." });
      res.json({ success: true, status: getWebPhoneStatus(userId) });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update settings" });
    }
  });

  app.delete("/api/web-phone/call-log", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    clearWebPhoneCallLog(userId);
    res.json({ success: true });
  });

  app.get("/api/web-phone/sessions", (_req: Request, res: Response) => {
    res.json({
      activeSessions: getActiveWebPhoneCount(),
      sessions: getAllWebPhoneSessions(),
    });
  });

  // ======= BUILD AGENT — AI Website/App Builder =======

  app.post("/api/build/projects", (req: Request, res: Response) => {
    try {
      const { userId, name, description } = req.body;
      if (!userId || !name) return res.status(400).json({ error: "userId and name are required" });
      const project = createProject(userId, name, description || "");
      res.json({ success: true, project });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/build/projects", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    res.json(getProjects(userId));
  });

  app.get("/api/build/projects/:id", (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const project = getProject(id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  });

  app.delete("/api/build/projects/:id", (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    deleteProject(id);
    res.json({ success: true });
  });

  app.post("/api/build/chat", async (req: Request, res: Response) => {
    try {
      const { projectId, message, files } = req.body;
      console.log("[BUILD CHAT] Request:", { projectId, messageLen: message?.length });
      if (!projectId || !message) return res.status(400).json({ error: "projectId and message are required" });

      const project = getProject(projectId);
      if (!project) {
        console.log("[BUILD CHAT] Project not found:", projectId);
        return res.status(404).json({ error: "Project not found" });
      }

      const userMsg = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        role: "user" as const,
        content: message,
        createdAt: new Date().toISOString(),
      };
      addMessageToProject(projectId, userMsg);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      let fullResponse = "";
      const stream = streamBuildAgent(projectId, message, files || project.files);

      for await (const content of stream) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }

      const parsedFiles = parseFilesFromResponse(fullResponse);
      if (Object.keys(parsedFiles).length > 0) {
        updateProjectFiles(projectId, parsedFiles);
        res.write(`data: ${JSON.stringify({ files: parsedFiles })}\n\n`);

        const previewSlug = project.previewSlug;
        const previewSubdomain = `${previewSlug}.cfgpt.org`;
        const previewDirectUrl = `/preview/${previewSlug}`;
        const previewNote = `\n\n---\nYour site is live at: https://${previewSubdomain}\nPreview: ${previewDirectUrl}`;
        fullResponse += previewNote;
        res.write(`data: ${JSON.stringify({ content: previewNote, previewUrl: `https://${previewSubdomain}`, previewSlug, previewDirect: previewDirectUrl })}\n\n`);
      }

      const assistantMsg = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        role: "assistant" as const,
        content: fullResponse,
        createdAt: new Date().toISOString(),
        files: parsedFiles,
      };
      addMessageToProject(projectId, assistantMsg);

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Build chat error:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Build agent error" });
      }
    }
  });

  app.post("/api/build/deploy", (req: Request, res: Response) => {
    try {
      const { projectId, domain, userId, userName } = req.body;
      if (!projectId) return res.status(400).json({ error: "projectId is required" });
      const project = deployProject(projectId, domain);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (userName) {
        addAdminNotification({
          type: "deploy",
          title: "Project Deployed",
          message: `${userName} deployed project "${project.name}"${domain ? ` to ${domain}` : ""}`,
          userId: userId || project.userId,
          userName: userName || project.userId,
          metadata: { projectId, projectName: project.name, domain },
        });
      }
      res.json({ success: true, project });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/build/github/connect", (req: Request, res: Response) => {
    const { userId, token } = req.body;
    if (!userId || !token) return res.status(400).json({ error: "userId and token are required" });
    setGithubToken(userId, token);
    res.json({ success: true });
  });

  app.delete("/api/build/github/disconnect", (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    removeGithubToken(userId);
    res.json({ success: true });
  });

  app.get("/api/build/github/status", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const token = getGithubToken(userId);
    res.json({ connected: !!token });
  });

  app.post("/api/build/github/push", async (req: Request, res: Response) => {
    try {
      const { userId, repoName, projectId, commitMessage } = req.body;
      if (!userId || !repoName || !projectId) {
        return res.status(400).json({ error: "userId, repoName, and projectId are required" });
      }
      const project = getProject(projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const result = await pushToGithub(userId, repoName, project.files, commitMessage);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ======= DOMAIN REQUESTS =======

  app.post("/api/domains/request", (req: Request, res: Response) => {
    try {
      const { userId, userName, userEmail, domain, paypalTransactionId } = req.body;
      if (!userId || !domain) return res.status(400).json({ error: "userId and domain are required" });
      const request = createDomainRequest(userId, userName || "", userEmail || "", domain, paypalTransactionId);
      res.json({ success: true, request });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/domains/requests", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    res.json(getDomainRequests(userId || undefined));
  });

  app.put("/api/domains/requests/:id", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const updated = updateDomainRequest(id, req.body);
      if (!updated) return res.status(404).json({ error: "Request not found" });
      res.json({ success: true, request: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ======= SUPPORT MESSAGES =======

  app.post("/api/support/messages", (req: Request, res: Response) => {
    try {
      const { userId, userName, userEmail, subject, message } = req.body;
      if (!userId || !subject || !message) {
        return res.status(400).json({ error: "userId, subject, and message are required" });
      }
      const msg = createSupportMessage(userId, userName || "", userEmail || "", subject, message);
      res.json({ success: true, message: msg });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/support/messages", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    res.json(getSupportMessages(userId || undefined));
  });

  app.put("/api/support/messages/:id", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const updated = updateSupportMessage(id, req.body);
      if (!updated) return res.status(404).json({ error: "Message not found" });
      res.json({ success: true, message: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ======= ADMIN NOTIFICATIONS =======

  app.get("/api/admin/notifications", (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({
      notifications: getAdminNotifications(limit),
      unreadCount: getUnreadNotificationCount(),
    });
  });

  app.post("/api/admin/notifications/:id/read", (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    markNotificationRead(id);
    res.json({ success: true });
  });

  app.post("/api/admin/notifications/read-all", (_req: Request, res: Response) => {
    markAllNotificationsRead();
    res.json({ success: true });
  });

  // ======= VIRTUAL MAC DEVICES =======

  app.post("/api/virtual-mac", (req: Request, res: Response) => {
    try {
      const { userId, name } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const device = createVirtualMac(userId, name || "Virtual Device");
      res.json({ success: true, device });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create virtual MAC" });
    }
  });

  app.get("/api/virtual-mac", (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const devices = getUserDevices(userId);
      res.json({ devices });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get devices" });
    }
  });

  app.put("/api/virtual-mac/:id", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { name, sipConfigId } = req.body;
      let device = null;
      if (name !== undefined) {
        device = updateDeviceName(id, name);
      }
      if (sipConfigId !== undefined) {
        device = linkDeviceToSip(id, sipConfigId);
      }
      if (!device) return res.status(404).json({ error: "Device not found" });
      res.json({ success: true, device });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update device" });
    }
  });

  app.post("/api/virtual-mac/:id/regenerate", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const device = regenerateDeviceMac(id);
      if (!device) return res.status(404).json({ error: "Device not found" });
      res.json({ success: true, device });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to regenerate MAC" });
    }
  });

  app.delete("/api/virtual-mac/:id", (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      const success = deleteDevice(id, userId);
      if (!success) return res.status(404).json({ error: "Device not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete device" });
    }
  });

  // ======= PROJECT PREVIEW =======

  const PREVIEW_BANNER = `<div id="cfgpt-preview-bar" style="position:fixed;top:0;left:0;right:0;z-index:999999;background:linear-gradient(90deg,#0d1117,#161b22);border-bottom:2px solid #00d4aa;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#c9d1d9;">
<div style="display:flex;align-items:center;gap:8px;"><span style="background:#00d4aa;color:#0d1117;padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;">PREVIEW</span><span>This is a preview on <strong style="color:#00d4aa;">cfgpt.org</strong></span></div>
<div style="display:flex;gap:12px;align-items:center;"><a href="https://cfgpt.org" style="color:#00d4aa;text-decoration:none;font-weight:600;">Build yours free &rarr;</a></div>
</div><div style="height:40px;"></div>`;

  function getMimeType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const types: Record<string, string> = {
      html: "text/html", css: "text/css", js: "application/javascript",
      json: "application/json", svg: "image/svg+xml", png: "image/png",
      jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      ico: "image/x-icon", txt: "text/plain", xml: "application/xml",
      woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
    };
    return types[ext] || "text/plain";
  }

  function serveProjectFile(project: ReturnType<typeof getProject>, filePath: string, res: Response, injectBanner: boolean) {
    if (!project) return res.status(404).send("Project not found");
    const file = filePath || "index.html";
    const content = project.files[file];
    if (!content) {
      if (file === "index.html") {
        const fileList = Object.keys(project.files);
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${project.name} - Preview</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px 20px}h1{color:#00d4aa;margin-bottom:8px}p{color:#8b949e;margin-bottom:24px}.files{list-style:none}.files li{margin-bottom:8px}.files a{color:#58a6ff;text-decoration:none;padding:8px 12px;display:inline-block;background:#161b22;border-radius:6px;border:1px solid #30363d}.files a:hover{border-color:#00d4aa}</style></head><body>${injectBanner ? PREVIEW_BANNER : ""}<h1>${project.name}</h1><p>Preview - No index.html found. Available files:</p><ul class="files">${fileList.map(f => `<li><a href="${f}">${f}</a></li>`).join("")}</ul></body></html>`;
        return res.type("text/html").send(html);
      }
      return res.status(404).send("File not found");
    }
    const mime = getMimeType(file);
    if (injectBanner && mime === "text/html" && content.includes("<body")) {
      const injected = content.replace(/<body([^>]*)>/i, `<body$1>${PREVIEW_BANNER}`);
      return res.type(mime).send(injected);
    }
    res.type(mime).send(content);
  }

  app.get("/preview/:slugOrId", (req: Request, res: Response) => {
    const param = Array.isArray(req.params.slugOrId) ? req.params.slugOrId[0] : req.params.slugOrId;
    const project = getProjectBySlug(param) || getProject(param);
    serveProjectFile(project, "", res, true);
  });

  app.get("/preview/:slugOrId/*filePath", (req: Request, res: Response) => {
    const param = Array.isArray(req.params.slugOrId) ? req.params.slugOrId[0] : req.params.slugOrId;
    const project = getProjectBySlug(param) || getProject(param);
    const fp = Array.isArray(req.params.filePath) ? req.params.filePath.join("/") : req.params.filePath;
    serveProjectFile(project, fp, res, false);
  });

  // ─── EL Voice Cloning ─────────────────────────────

  app.get("/api/elevenlabs/voices", async (_req: Request, res: Response) => {
    try {
      const voices = await listVoices();
      res.json({ voices });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/elevenlabs/clone", async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      await new Promise<void>((resolve) => req.on("end", resolve));

      if (req.headers["content-type"]?.includes("application/json")) {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (!body.audioBase64 || !body.name) {
          return res.status(400).json({ error: "name and audioBase64 are required" });
        }
        const audioBuffer = Buffer.from(body.audioBase64, "base64");
        const result = await cloneVoice(body.name, audioBuffer, body.description);
        return res.json(result);
      }

      if (!name) {
        return res.status(400).json({ error: "name is required" });
      }
      const audioBuffer = Buffer.concat(chunks);
      if (audioBuffer.length === 0) {
        return res.status(400).json({ error: "audio data is required" });
      }
      const result = await cloneVoice(name, audioBuffer, description);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/elevenlabs/voices/:voiceId", async (req: Request, res: Response) => {
    try {
      const voiceId = Array.isArray(req.params.voiceId) ? req.params.voiceId[0] : req.params.voiceId;
      await deleteVoice(voiceId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/elevenlabs/tts", async (req: Request, res: Response) => {
    try {
      const { voiceId, text } = req.body;
      if (!voiceId || !text) {
        return res.status(400).json({ error: "voiceId and text are required" });
      }
      const audioBuffer = await elTextToSpeech(voiceId, text);
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(audioBuffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── EL Agent Widgets ───────────────────────────────

  app.post("/api/agents/create", async (req: Request, res: Response) => {
    try {
      const { userId, name, voiceId, systemPrompt, greeting } = req.body;
      if (!userId || !name || !voiceId) {
        return res.status(400).json({ error: "userId, name, and voiceId are required" });
      }
      const widget = await createAgentWidget(
        userId,
        name,
        voiceId,
        systemPrompt || "You are a helpful AI assistant.",
        greeting || "Hello! How can I help you today?"
      );
      res.json(widget);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agents", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      const widgets = await listWidgets(userId);
      res.json({ widgets });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/agents/:widgetId", async (req: Request, res: Response) => {
    try {
      const widgetId = Array.isArray(req.params.widgetId) ? req.params.widgetId[0] : req.params.widgetId;
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      const deleted = await deleteWidget(userId, widgetId);
      if (!deleted) {
        return res.status(404).json({ error: "Widget not found or access denied" });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agents/call/start", async (req: Request, res: Response) => {
    try {
      const { widgetId, userId } = req.body;
      if (!widgetId || !userId) {
        return res.status(400).json({ error: "widgetId and userId are required" });
      }
      const session = await startCallSession(widgetId, userId);
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agents/call/end", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId is required" });
      }
      const result = await endCallSession(sessionId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agents/call/active", async (req: Request, res: Response) => {
    try {
      const widgetId = req.query.widgetId as string;
      if (!widgetId) {
        return res.status(400).json({ error: "widgetId is required" });
      }
      const session = await getActiveSession(widgetId);
      res.json({ session });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/telnyx/available-numbers", async (req: Request, res: Response) => {
    try {
      const country = (req.query.country as string) || "GB";
      const numbers = await searchAvailableNumbers(country, 20);
      res.json(numbers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/telnyx/order-number", async (req: Request, res: Response) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ error: "phoneNumber is required" });
      }
      const result = await orderNumber(phoneNumber);
      res.json({ success: true, order: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/telnyx/owned-numbers", async (_req: Request, res: Response) => {
    try {
      const numbers = await listOwnedNumbers();
      res.json(numbers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
