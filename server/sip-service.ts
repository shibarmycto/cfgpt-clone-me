import * as net from "node:net";
import * as dgram from "node:dgram";
import * as crypto from "node:crypto";
import * as dns from "node:dns/promises";
import { RtpSession, parseSdpRemoteEndpoint, pcm16ToUlaw8k, wavToUlaw8k, generateSilenceUlaw } from "./rtp-audio";
import { textToSpeech } from "./replit_integrations/audio/client";
import { textToSpeech as elevenLabsTts } from "./elevenlabs";

let cachedPublicIp: string | null = null;
let publicIpFetchedAt = 0;
const PUBLIC_IP_CACHE_TTL = 300000;

async function resolvePublicIp(): Promise<string | null> {
  if (cachedPublicIp && Date.now() - publicIpFetchedAt < PUBLIC_IP_CACHE_TTL) {
    return cachedPublicIp;
  }
  try {
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDomain) {
      const addresses = await dns.resolve4(replitDomain);
      if (addresses && addresses.length > 0) {
        cachedPublicIp = addresses[0];
        publicIpFetchedAt = Date.now();
        console.log(`[SIP] Resolved public IP from REPLIT_DEV_DOMAIN: ${cachedPublicIp}`);
        return cachedPublicIp;
      }
    }
  } catch (e: any) {
    console.log(`[SIP] Failed to resolve REPLIT_DEV_DOMAIN: ${e.message}`);
  }
  try {
    const res = await fetch("https://api.ipify.org?format=text");
    if (res.ok) {
      const ip = (await res.text()).trim();
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        cachedPublicIp = ip;
        publicIpFetchedAt = Date.now();
        console.log(`[SIP] Resolved public IP from ipify: ${cachedPublicIp}`);
        return cachedPublicIp;
      }
    }
  } catch (e: any) {
    console.log(`[SIP] Failed to fetch public IP from ipify: ${e.message}`);
  }
  return null;
}

export interface SipConfigServer {
  domain: string;
  port: number;
  username: string;
  authUsername: string;
  password: string;
  transport: "TCP" | "UDP" | "TLS";
  inboundNumber: string;
}

export interface SipStatus {
  registered: boolean;
  registering: boolean;
  error: string | null;
  lastRegistered: string | null;
  callsHandled: number;
  activeCall: boolean;
  localAddress: string | null;
  sipUri: string | null;
}

interface SipMessage {
  method?: string;
  statusCode?: number;
  statusText?: string;
  uri?: string;
  version: string;
  headers: Record<string, string>;
  body: string;
  raw: string;
}

type CallHandler = (
  callerNumber: string,
  calledNumber: string,
  callId: string,
  routedSipUser?: string
) => Promise<string>;

let callCounter = 0;

function generateTag(): string {
  return crypto.randomBytes(8).toString("hex");
}

function generateBranch(): string {
  return "z9hG4bK" + crypto.randomBytes(8).toString("hex");
}

function generateCallId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function parseSipMessage(data: string): SipMessage | null {
  try {
    const parts = data.split("\r\n\r\n");
    const headerSection = parts[0];
    const body = parts.slice(1).join("\r\n\r\n");
    const lines = headerSection.split("\r\n");
    const firstLine = lines[0];

    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const colonIdx = lines[i].indexOf(":");
      if (colonIdx > 0) {
        const key = lines[i].substring(0, colonIdx).trim().toLowerCase();
        const val = lines[i].substring(colonIdx + 1).trim();
        headers[key] = val;
      }
    }

    if (firstLine.startsWith("SIP/")) {
      const match = firstLine.match(/^SIP\/(\d\.\d)\s+(\d+)\s+(.*)/);
      if (!match) return null;
      return {
        version: match[1],
        statusCode: parseInt(match[2]),
        statusText: match[3],
        headers,
        body,
        raw: data,
      };
    } else {
      const match = firstLine.match(/^(\w+)\s+(.*)\s+SIP\/(\d\.\d)/);
      if (!match) return null;
      return {
        method: match[1],
        uri: match[2],
        version: match[3],
        headers,
        body,
        raw: data,
      };
    }
  } catch {
    return null;
  }
}

function computeDigestResponse(
  username: string,
  password: string,
  realm: string,
  nonce: string,
  method: string,
  uri: string,
  qop?: string,
  nc?: string,
  cnonce?: string
): string {
  const ha1 = crypto
    .createHash("md5")
    .update(`${username}:${realm}:${password}`)
    .digest("hex");
  const ha2 = crypto
    .createHash("md5")
    .update(`${method}:${uri}`)
    .digest("hex");

  if (qop === "auth" && nc && cnonce) {
    return crypto
      .createHash("md5")
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      .digest("hex");
  }

  return crypto
    .createHash("md5")
    .update(`${ha1}:${nonce}:${ha2}`)
    .digest("hex");
}

function parseWwwAuthenticate(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = header.match(/^Digest\s+(.*)/i);
  if (!match) return result;

  const params = match[1];
  const regex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
  let m;
  while ((m = regex.exec(params)) !== null) {
    result[m[1]] = m[2] || m[3];
  }
  return result;
}

export class SipService {
  private config: SipConfigServer | null = null;
  private tcpSocket: net.Socket | null = null;
  private udpSocket: dgram.Socket | null = null;
  private status: SipStatus = {
    registered: false,
    registering: false,
    error: null,
    lastRegistered: null,
    callsHandled: 0,
    activeCall: false,
    localAddress: null,
    sipUri: null,
  };
  private reregisterTimer: ReturnType<typeof setInterval> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private phoneRoutes: Map<string, string> = new Map();
  private cseq = 1;
  private tag = generateTag();
  private callId = generateCallId();
  private localPort = 0;
  private localHost = "0.0.0.0";
  private publicIp: string | null = null;
  private onCallHandler: CallHandler | null = null;
  private buffer = "";
  private activeCalls: Map<
    string,
    { from: string; to: string; startTime: Date; rtpSession?: RtpSession; pendingTts?: { text: string; voice: string }; inviteMsg?: SipMessage }
  > = new Map();
  private logs: string[] = [];
  private resolveCallback: ((value: boolean) => void) | null = null;
  private ttsVoice: string = "nova";

  constructor() {}

  setCallHandler(handler: CallHandler) {
    this.onCallHandler = handler;
  }

  setTtsVoice(voice: string) {
    this.ttsVoice = voice;
  }

  getStatus() {
    return {
      ...this.status,
      phoneRouteCount: this.phoneRoutes.size,
      phoneRoutes: this.getPhoneRoutes(),
    };
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  private log(msg: string) {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    console.log(`[SIP] ${msg}`);
  }

  async register(config: SipConfigServer): Promise<boolean> {
    if (this.status.registering) {
      this.log("Already registering, please wait...");
      return false;
    }

    await this.cleanup();

    this.config = config;
    this.status.registering = true;
    this.status.registered = false;
    this.status.error = null;
    this.status.sipUri = `sip:${config.username}@${config.domain}`;
    this.tag = generateTag();
    this.callId = generateCallId();
    this.cseq = 1;
    this.buffer = "";
    this.publicIp = null;

    const resolvedIp = await resolvePublicIp();
    if (resolvedIp) {
      this.publicIp = resolvedIp;
      this.log(`Using resolved public IP: ${resolvedIp}`);
    }

    this.log(
      `Starting SIP registration to ${config.domain}:${config.port} via ${config.transport}`
    );
    this.log(
      `Username: ${config.username}, Auth: ${config.authUsername || config.username}`
    );

    if (!config.password) {
      this.log("WARNING: No password provided - authentication will likely fail");
    }

    try {
      if (config.transport === "UDP") {
        return await this.registerUdp();
      } else {
        return await this.registerTcp();
      }
    } catch (err: any) {
      this.status.registering = false;
      this.status.error = err.message || "Registration failed";
      this.log(`Registration error: ${this.status.error}`);
      return false;
    }
  }

  private async cleanup(preserveActiveCalls: boolean = false) {
    if (this.reregisterTimer) {
      clearInterval(this.reregisterTimer);
      this.reregisterTimer = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (!preserveActiveCalls) {
      for (const [, call] of this.activeCalls) {
        if (call.rtpSession) {
          call.rtpSession.close();
        }
      }
      this.activeCalls.clear();
    }
    try {
      if (this.tcpSocket && !this.tcpSocket.destroyed) {
        this.tcpSocket.removeAllListeners();
        this.tcpSocket.destroy();
      }
    } catch {}
    try {
      if (this.udpSocket) {
        this.udpSocket.removeAllListeners();
        this.udpSocket.close();
      }
    } catch {}
    this.tcpSocket = null;
    this.udpSocket = null;
    this.resolveCallback = null;
  }

  private async registerTcp(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveCallback = resolve;

      const socket = new net.Socket();
      this.tcpSocket = socket;

      const timeout = setTimeout(() => {
        this.status.registering = false;
        this.status.error = "Connection timeout - server not reachable on " + this.config!.domain + ":" + this.config!.port;
        this.log("TCP connection timeout after 20s");
        this.resolveCallback = null;
        try { socket.destroy(); } catch {}
        resolve(false);
      }, 20000);

      socket.connect(this.config!.port, this.config!.domain, () => {
        clearTimeout(timeout);
        socket.setKeepAlive(true, 10000);
        socket.setNoDelay(true);
        this.localPort = socket.localPort || 0;
        this.localHost = socket.localAddress || "0.0.0.0";
        this.status.localAddress = `${this.localHost}:${this.localPort}`;
        this.log(
          `TCP connected to ${this.config!.domain}:${this.config!.port} from ${this.localHost}:${this.localPort}`
        );
        this.sendRegister(false);
      });

      socket.on("data", (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        this.status.registering = false;
        this.status.registered = false;
        this.status.error = `Connection error: ${err.message}`;
        this.log(`TCP error: ${err.message}`);
        if (this.resolveCallback) {
          this.resolveCallback(false);
          this.resolveCallback = null;
        }
      });

      socket.on("close", () => {
        this.log("TCP connection closed");
        if (this.status.registered) {
          this.status.registered = false;
          this.log("Lost registration due to connection close");
          this.scheduleReconnect();
        }
        if (this.resolveCallback) {
          this.status.registering = false;
          this.status.error = "Connection closed unexpectedly";
          this.resolveCallback(false);
          this.resolveCallback = null;
        }
      });
    });
  }

  private async registerUdp(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveCallback = resolve;

      const socket = dgram.createSocket("udp4");
      this.udpSocket = socket;

      const timeout = setTimeout(() => {
        this.status.registering = false;
        this.status.error = "Registration timeout - no response from server (UDP). Try TCP instead.";
        this.log("UDP registration timeout after 20s");
        this.resolveCallback = null;
        resolve(false);
      }, 20000);

      socket.on("message", (msg) => {
        clearTimeout(timeout);
        this.buffer += msg.toString();
        this.processBuffer();
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        this.status.registering = false;
        this.status.error = `UDP error: ${err.message}`;
        this.log(`UDP error: ${err.message}`);
        if (this.resolveCallback) {
          this.resolveCallback(false);
          this.resolveCallback = null;
        }
      });

      socket.bind(0, () => {
        const addr = socket.address();
        this.localPort = addr.port;
        this.localHost = "0.0.0.0";
        this.status.localAddress = `${this.localHost}:${this.localPort}`;
        this.log(`UDP bound to port ${this.localPort}`);
        this.sendRegister(false);
      });
    });
  }

  private processBuffer() {
    while (this.buffer.includes("\r\n\r\n")) {
      const endIdx = this.buffer.indexOf("\r\n\r\n") + 4;
      let contentLength = 0;

      const headerPart = this.buffer.substring(
        0,
        this.buffer.indexOf("\r\n\r\n")
      );
      const clMatch = headerPart.match(/content-length:\s*(\d+)/i);
      if (clMatch) contentLength = parseInt(clMatch[1]);

      const totalLength = endIdx + contentLength;
      if (this.buffer.length < totalLength) break;

      const msgStr = this.buffer.substring(0, totalLength);
      this.buffer = this.buffer.substring(totalLength);

      const msg = parseSipMessage(msgStr);
      if (msg) {
        this.handleMessage(msg);
      }
    }
  }

  private handleMessage(msg: SipMessage) {
    if (msg.statusCode) {
      this.handleResponse(msg);
    } else if (msg.method) {
      this.handleRequest(msg);
    }
  }

  private handleResponse(msg: SipMessage) {
    const code = msg.statusCode!;
    this.log(`Received ${code} ${msg.statusText}`);

    const viaHeader = msg.headers["via"] || "";
    const receivedMatch = viaHeader.match(/received=([0-9.]+)/);
    if (receivedMatch && !this.publicIp) {
      this.publicIp = receivedMatch[1];
      this.log(`Discovered public IP: ${this.publicIp}`);
    }

    if (code === 401 || code === 407) {
      const authHeader =
        msg.headers["www-authenticate"] || msg.headers["proxy-authenticate"];
      if (authHeader) {
        this.log("Received authentication challenge, sending credentials...");
        this.sendRegister(true, authHeader);
      } else {
        this.status.registering = false;
        this.status.error = "Auth challenge without credentials request";
        this.log("ERROR: Server sent 401 but no WWW-Authenticate header");
        if (this.resolveCallback) {
          this.resolveCallback(false);
          this.resolveCallback = null;
        }
      }
    } else if (code === 200) {
      const cseqHeader = msg.headers["cseq"] || "";
      if (cseqHeader.includes("REGISTER")) {
        this.status.registered = true;
        this.status.registering = false;
        this.status.error = null;
        this.status.lastRegistered = new Date().toISOString();

        const expiresHeader = msg.headers["expires"];
        const contactHeader = msg.headers["contact"] || "";
        const expiresMatch = contactHeader.match(/expires=(\d+)/);
        const expires = expiresMatch
          ? parseInt(expiresMatch[1])
          : expiresHeader
            ? parseInt(expiresHeader)
            : 3600;

        this.log(`Successfully registered! Expires in ${expires}s`);
        this.startKeepAlive();
        this.scheduleReregister(60);

        if (this.resolveCallback) {
          this.resolveCallback(true);
          this.resolveCallback = null;
        }
      }
    } else if (code === 403) {
      this.status.registering = false;
      this.status.error =
        "Authentication failed (403 Forbidden). Please check your SIP username, authorization username, and password are correct.";
      this.log("Registration FORBIDDEN (403) - credentials rejected by server");

      if (this.resolveCallback) {
        this.resolveCallback(false);
        this.resolveCallback = null;
      }
    } else if (code === 423) {
      this.status.registering = false;
      this.status.error =
        "Registration interval too short. Try again.";
      this.log("423 Interval Too Brief");

      if (this.resolveCallback) {
        this.resolveCallback(false);
        this.resolveCallback = null;
      }
    } else if (code >= 400) {
      this.status.registering = false;
      this.status.error = `Server error: ${code} ${msg.statusText}`;
      this.log(`Registration failed: ${code} ${msg.statusText}`);

      if (this.resolveCallback) {
        this.resolveCallback(false);
        this.resolveCallback = null;
      }
    }
  }

  private handleRequest(msg: SipMessage) {
    if (msg.method === "INVITE") {
      this.handleInvite(msg);
    } else if (msg.method === "BYE") {
      this.handleBye(msg);
    } else if (msg.method === "ACK") {
      this.handleAck(msg);
    } else if (msg.method === "OPTIONS") {
      this.sendResponse(msg, 200, "OK");
    } else if (msg.method === "CANCEL") {
      this.handleCancel(msg);
    } else {
      this.log(`Received unhandled request: ${msg.method}`);
    }
  }

  private async handleInvite(msg: SipMessage) {
    const fromHeader = msg.headers["from"] || "";
    const toHeader = msg.headers["to"] || "";
    const callId = msg.headers["call-id"] || "";
    const requestUri = msg.uri || "";

    const callerMatch = fromHeader.match(/sip:([^@>]+)/);
    const calledMatch = toHeader.match(/sip:([^@>]+)/);
    const uriMatch = requestUri.match(/sip:([^@>]+)/);
    const callerNumber = callerMatch ? callerMatch[1] : "unknown";
    const calledNumber = calledMatch ? calledMatch[1] : "unknown";
    const requestNumber = uriMatch ? uriMatch[1] : calledNumber;

    this.log(
      `Incoming call from ${callerNumber} to ${calledNumber} (URI: ${requestNumber}) (${callId})`
    );

    let routedSipUser: string | undefined;

    const numbersToCheck = [calledNumber, requestNumber];
    if (this.config?.inboundNumber) {
      numbersToCheck.push(this.config.inboundNumber);
    }

    for (const num of numbersToCheck) {
      const normalizedNum = num.replace(/[^0-9+]/g, "");
      
      routedSipUser = this.phoneRoutes.get(num);
      if (!routedSipUser) {
        routedSipUser = this.phoneRoutes.get(normalizedNum);
      }
      if (!routedSipUser) {
        for (const [routeNum, sipUser] of this.phoneRoutes.entries()) {
          const normalizedRoute = routeNum.replace(/[^0-9+]/g, "");
          if (normalizedNum.endsWith(normalizedRoute) || normalizedRoute.endsWith(normalizedNum)) {
            routedSipUser = sipUser;
            break;
          }
        }
      }
      if (routedSipUser) break;
    }

    if (routedSipUser) {
      this.log(`Phone route matched: ${calledNumber} -> SIP user: ${routedSipUser}`);
    } else {
      this.log(`No specific phone route found for ${calledNumber}, using default AI receptionist`);
    }

    callCounter++;
    this.status.callsHandled = callCounter;
    this.status.activeCall = true;

    this.sendResponse(msg, 100, "Trying");
    this.sendResponse(msg, 180, "Ringing");

    try {
      const remoteRtp = parseSdpRemoteEndpoint(msg.body);
      if (remoteRtp) {
        this.log(`Remote RTP endpoint from SDP: ${remoteRtp.ip}:${remoteRtp.port}`);
      } else {
        this.log(`WARNING: Could not parse remote RTP endpoint from INVITE SDP`);
      }

      let aiResponse = "Thank you for calling. How may I help you today?";
      if (this.onCallHandler) {
        aiResponse = await this.onCallHandler(
          callerNumber,
          calledNumber,
          callId,
          routedSipUser
        );
      }

      this.log(
        `AI receptionist response for ${routedSipUser || "default"}: ${aiResponse.substring(0, 100)}...`
      );

      let rtpSession: RtpSession | undefined;
      let rtpPort = this.localPort + 2;

      if (remoteRtp) {
        rtpSession = new RtpSession(remoteRtp, (msg) => this.log(msg));
        try {
          rtpPort = await rtpSession.open();
          this.log(`RTP session opened on local port ${rtpPort}`);
        } catch (err: any) {
          this.log(`RTP session open failed: ${err.message}`);
          rtpSession = undefined;
        }
      }

      this.activeCalls.set(callId, {
        from: callerNumber,
        to: calledNumber,
        startTime: new Date(),
        rtpSession,
        pendingTts: { text: aiResponse, voice: this.ttsVoice },
        inviteMsg: msg,
      });

      const sdpBody = this.generateSdpWithPort(rtpPort);
      this.sendResponse(msg, 200, "OK", sdpBody);
    } catch (err: any) {
      this.log(`Call handling error: ${err.message}`);
      this.sendResponse(msg, 500, "Server Error");
      this.status.activeCall = false;
      this.activeCalls.delete(callId);
    }
  }

  private handleBye(msg: SipMessage) {
    const callId = msg.headers["call-id"] || "";
    this.log(`Call ended: ${callId}`);
    this.sendResponse(msg, 200, "OK");
    const call = this.activeCalls.get(callId);
    if (call?.rtpSession) {
      call.rtpSession.close();
    }
    this.activeCalls.delete(callId);
    this.status.activeCall = this.activeCalls.size > 0;
  }

  private handleCancel(msg: SipMessage) {
    const callId = msg.headers["call-id"] || "";
    this.log(`Call cancelled: ${callId}`);
    this.sendResponse(msg, 200, "OK");
    const call = this.activeCalls.get(callId);
    if (call?.rtpSession) {
      call.rtpSession.close();
    }
    this.activeCalls.delete(callId);
    this.status.activeCall = this.activeCalls.size > 0;
  }

  private handleAck(msg: SipMessage) {
    const callId = msg.headers["call-id"] || "";
    this.log(`Received ACK for call ${callId} - call established`);

    const call = this.activeCalls.get(callId);
    if (call?.rtpSession && call.pendingTts) {
      this.log(`Starting TTS audio streaming for call ${callId}`);
      this.streamTtsToCall(callId, call.pendingTts.text, call.pendingTts.voice);
      call.pendingTts = undefined;
    } else if (!call?.rtpSession) {
      this.log(`WARNING: No RTP session for call ${callId}, cannot stream audio`);
    }
  }

  private async streamTtsToCall(callId: string, text: string, voice: string) {
    const call = this.activeCalls.get(callId);
    if (!call?.rtpSession) {
      this.log(`No RTP session for call ${callId}`);
      return;
    }

    try {
      this.log(`Generating TTS audio: "${text.substring(0, 60)}..." voice=${voice}`);

      call.rtpSession.sendSilence(200).catch(() => {});

      const startTime = Date.now();
      let audioBuffer: Buffer;
      let usedElevenLabs = false;

      if (process.env.ELEVENLABS_API_KEY) {
        try {
          const elVoiceId = voice || "21m00Tcm4TlvDq8ikWAM";
          this.log(`Trying ElevenLabs TTS with voice ${elVoiceId}`);
          const mp3Buffer = await elevenLabsTts(elVoiceId, text);
          audioBuffer = mp3Buffer;
          usedElevenLabs = true;
          this.log(`ElevenLabs TTS generated in ${Date.now() - startTime}ms, MP3 size: ${audioBuffer.length} bytes`);
        } catch (elErr: any) {
          this.log(`ElevenLabs TTS failed, falling back to Replit TTS: ${elErr.message}`);
          const ttsVoice = (voice || "nova") as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
          audioBuffer = await textToSpeech(text, ttsVoice, "wav");
        }
      } else {
        const ttsVoice = (voice || "nova") as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
        audioBuffer = await textToSpeech(text, ttsVoice, "wav");
      }

      const ttsTime = Date.now() - startTime;
      this.log(`TTS generated in ${ttsTime}ms, audio size: ${audioBuffer.length} bytes (ElevenLabs: ${usedElevenLabs})`);

      if (!this.activeCalls.has(callId)) {
        this.log(`Call ${callId} ended before TTS completed`);
        return;
      }

      let ulawData: Buffer;
      if (usedElevenLabs) {
        ulawData = pcm16ToUlaw8k(audioBuffer, 24000);
      } else {
        ulawData = wavToUlaw8k(audioBuffer);
      }
      this.log(`Converted to u-law: ${ulawData.length} bytes (${(ulawData.length / 8000).toFixed(1)}s of audio)`);

      await call.rtpSession.streamAudio(ulawData);
      this.log(`TTS audio streaming complete for call ${callId}`);

      await call.rtpSession.sendSilence(5000);
    } catch (err: any) {
      this.log(`TTS streaming error for call ${callId}: ${err.message}`);
    }
  }

  private generateSdpWithPort(rtpPort: number): string {
    const ip = this.publicIp || cachedPublicIp || (this.localHost === "0.0.0.0" ? "127.0.0.1" : this.localHost);
    return [
      "v=0",
      `o=cfgpt 0 0 IN IP4 ${ip}`,
      "s=CFGPT AI Receptionist",
      `c=IN IP4 ${ip}`,
      "t=0 0",
      `m=audio ${rtpPort} RTP/AVP 0 8 101`,
      "a=rtpmap:0 PCMU/8000",
      "a=rtpmap:8 PCMA/8000",
      "a=rtpmap:101 telephone-event/8000",
      "a=fmtp:101 0-16",
      "a=sendrecv",
      "a=ptime:20",
    ].join("\r\n");
  }

  private generateSdp(): string {
    return this.generateSdpWithPort(this.localPort + 2);
  }

  private sendRegister(withAuth: boolean, authHeader?: string) {
    if (!this.config) return;
    this.cseq++;

    const transportStr =
      this.config.transport === "UDP" ? "UDP" : "TCP";
    const branch = generateBranch();
    const regUri = `sip:${this.config.domain}`;
    const fromUri = `sip:${this.config.username}@${this.config.domain}`;

    const contactHost = this.publicIp || this.localHost;
    const contactUri = `sip:${this.config.username}@${contactHost}:${this.localPort};transport=${transportStr.toLowerCase()}`;

    let authLine = "";
    if (withAuth && authHeader) {
      const params = parseWwwAuthenticate(authHeader);
      const authUser = this.config.authUsername || this.config.username;
      const cnonce = crypto.randomBytes(8).toString("hex");
      const nc = "00000001";

      const realm = params.realm || this.config.domain;
      const nonce = params.nonce || "";

      this.log(`Auth digest: user=${authUser}, realm=${realm}, nonce=${nonce.substring(0, 8)}...`);

      const response = computeDigestResponse(
        authUser,
        this.config.password,
        realm,
        nonce,
        "REGISTER",
        regUri,
        params.qop,
        nc,
        cnonce
      );

      authLine = `Authorization: Digest username="${authUser}", realm="${realm}", nonce="${nonce}", uri="${regUri}", response="${response}", algorithm=MD5`;
      if (params.qop) {
        authLine += `, qop=${params.qop}, nc=${nc}, cnonce="${cnonce}"`;
      }
      if (params.opaque) {
        authLine += `, opaque="${params.opaque}"`;
      }
    }

    const lines = [
      `REGISTER ${regUri} SIP/2.0`,
      `Via: SIP/2.0/${transportStr} ${this.localHost}:${this.localPort};rport;branch=${branch}`,
      `Max-Forwards: 70`,
      `From: <${fromUri}>;tag=${this.tag}`,
      `To: <${fromUri}>`,
      `Call-ID: ${this.callId}`,
      `CSeq: ${this.cseq} REGISTER`,
      `Contact: <${contactUri}>`,
      `Expires: 3600`,
    ];

    if (authLine) {
      lines.push(authLine);
    }

    lines.push(
      `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, NOTIFY`,
      `User-Agent: CFGPT/1.0`,
      `Content-Length: 0`,
      ``,
      ``
    );

    const message = lines.join("\r\n");
    this.sendRaw(message);
    this.log(`Sent REGISTER (CSeq: ${this.cseq}, auth: ${withAuth})`);
  }

  private sendResponse(
    request: SipMessage,
    code: number,
    reason: string,
    body?: string
  ) {
    if (!this.config) return;

    const via = request.headers["via"] || "";
    const from = request.headers["from"] || "";
    const to = request.headers["to"] || "";
    const callId = request.headers["call-id"] || "";
    const cseq = request.headers["cseq"] || "";

    const toWithTag = to.includes("tag=")
      ? to
      : `${to};tag=${generateTag()}`;
    const contentType = body ? "Content-Type: application/sdp\r\n" : "";
    const contentLength = body ? Buffer.byteLength(body) : 0;

    const contactHost = this.publicIp || this.localHost;

    const lines = [
      `SIP/2.0 ${code} ${reason}`,
      `Via: ${via}`,
      `From: ${from}`,
      `To: ${toWithTag}`,
      `Call-ID: ${callId}`,
      `CSeq: ${cseq}`,
      `Contact: <sip:${this.config.username}@${contactHost}:${this.localPort}>`,
      `User-Agent: CFGPT/1.0`,
    ];

    if (contentType) {
      lines.push(`Content-Type: application/sdp`);
    }

    lines.push(
      `Content-Length: ${contentLength}`,
      ``,
      body || ``
    );

    const response = lines.join("\r\n");
    this.sendRaw(response);
    this.log(`Sent ${code} ${reason}`);
  }

  private sendRaw(message: string) {
    try {
      if (this.config?.transport === "UDP" && this.udpSocket) {
        const buf = Buffer.from(message);
        this.udpSocket.send(
          buf,
          0,
          buf.length,
          this.config.port,
          this.config.domain
        );
      } else if (this.tcpSocket && !this.tcpSocket.destroyed) {
        this.tcpSocket.write(message);
      } else {
        this.log("ERROR: No active socket to send message");
      }
    } catch (err: any) {
      this.log(`Send error: ${err.message}`);
    }
  }

  private scheduleReregister(intervalSeconds: number = 60) {
    if (this.reregisterTimer) {
      clearInterval(this.reregisterTimer);
    }
    const intervalMs = intervalSeconds * 1000;
    this.log(`Scheduling re-registration every ${intervalSeconds}s`);

    this.reregisterTimer = setInterval(() => {
      if (this.status.registered && this.config) {
        this.log("Re-registering...");
        this.sendRegister(false);
      }
    }, intervalMs);
  }

  private scheduleReconnect() {
    setTimeout(async () => {
      if (
        this.config &&
        !this.status.registered &&
        !this.status.registering
      ) {
        this.log("Attempting to reconnect (preserving active calls)...");
        const hasActiveCalls = this.activeCalls.size > 0;
        await this.reconnect(this.config);
      }
    }, 5000);
  }

  private async reconnect(config: SipConfigServer): Promise<boolean> {
    if (this.status.registering) return false;
    
    await this.cleanup(true);
    
    this.config = config;
    this.status.registering = true;
    this.status.registered = false;
    this.status.error = null;
    this.status.sipUri = `sip:${config.username}@${config.domain}`;
    this.tag = generateTag();
    this.callId = generateCallId();
    this.cseq = 1;
    this.buffer = "";

    try {
      if (config.transport === "UDP") {
        return await this.registerUdp();
      } else {
        return await this.registerTcp();
      }
    } catch (err: any) {
      this.status.registering = false;
      this.status.error = err.message || "Reconnection failed";
      this.log(`Reconnection error: ${this.status.error}`);
      return false;
    }
  }

  private startKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
    this.log("Starting SIP OPTIONS keepalive every 20s");
    this.keepAliveTimer = setInterval(() => {
      if (this.status.registered && this.config) {
        this.sendKeepAlive();
      }
    }, 20000);
  }

  private sendKeepAlive() {
    if (!this.config) return;
    this.cseq++;

    const transportStr = this.config.transport === "UDP" ? "UDP" : "TCP";
    const branch = generateBranch();
    const fromUri = `sip:${this.config.username}@${this.config.domain}`;
    const toUri = `sip:${this.config.domain}`;
    const contactHost = this.publicIp || this.localHost;

    const lines = [
      `OPTIONS ${toUri} SIP/2.0`,
      `Via: SIP/2.0/${transportStr} ${this.localHost}:${this.localPort};rport;branch=${branch}`,
      `Max-Forwards: 70`,
      `From: <${fromUri}>;tag=${this.tag}`,
      `To: <${toUri}>`,
      `Call-ID: ${this.callId}`,
      `CSeq: ${this.cseq} OPTIONS`,
      `Contact: <sip:${this.config.username}@${contactHost}:${this.localPort};transport=${transportStr.toLowerCase()}>`,
      `Accept: application/sdp`,
      `User-Agent: CFGPT/1.0`,
      `Content-Length: 0`,
      ``,
      ``,
    ];

    const message = lines.join("\r\n");
    this.sendRaw(message);
    this.log(`Sent OPTIONS keepalive (CSeq: ${this.cseq})`);
  }

  setPhoneRoute(phoneNumber: string, sipUser: string) {
    this.phoneRoutes.set(phoneNumber, sipUser);
    this.log(`Phone route set: ${phoneNumber} -> ${sipUser}`);
  }

  removePhoneRoute(phoneNumber: string) {
    this.phoneRoutes.delete(phoneNumber);
    this.log(`Phone route removed: ${phoneNumber}`);
  }

  getPhoneRoutes(): Record<string, string> {
    const routes: Record<string, string> = {};
    this.phoneRoutes.forEach((sipUser, phoneNumber) => {
      routes[phoneNumber] = sipUser;
    });
    return routes;
  }

  getPhoneRouteTarget(phoneNumber: string): string | undefined {
    return this.phoneRoutes.get(phoneNumber);
  }

  async unregister(): Promise<void> {
    await this.cleanup();
    this.status.registered = false;
    this.status.registering = false;
    this.status.error = null;
    this.log("Unregistered and disconnected");
  }
}

export const sipService = new SipService();
