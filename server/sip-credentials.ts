import { randomBytes, randomUUID } from "crypto";

export interface SipTrunkConfig {
  id: string;
  userId: string;
  phoneNumber: string;
  sipUsername: string;
  sipPassword: string;
  sipServerTcp: string;
  sipServerTls: string;
  sipUri: string;
  mediaEncryption: "allowed" | "required" | "disabled";
  allowedNumbers: string[];
  allowedSourceIps: string[];
  remoteDomains: string[];
  authUsername: string;
  authPassword: string;
  createdAt: string;
  lastUsed: string | null;
  active: boolean;
}

const SIP_DOMAIN = "sip.cfgpt.org";
const SIP_TCP_PORT = 5060;
const SIP_TLS_PORT = 5061;

const trunkStore = new Map<string, SipTrunkConfig>();

function generateUsername(): string {
  const num = Math.floor(10000 + Math.random() * 90000);
  const suffix = randomBytes(4).toString("hex");
  return `${num}.${suffix}`;
}

function generatePassword(): string {
  return randomBytes(20).toString("base64url");
}

export function generateTrunk(userId: string, phoneNumber: string): SipTrunkConfig {
  const existing = Array.from(trunkStore.values()).find(
    (t) => t.userId === userId && t.active
  );
  if (existing) {
    if (phoneNumber && phoneNumber !== existing.phoneNumber) {
      existing.phoneNumber = phoneNumber;
    }
    return existing;
  }

  const id = randomUUID();
  const sipUsername = generateUsername();
  const sipPassword = generatePassword();

  const trunk: SipTrunkConfig = {
    id,
    userId,
    phoneNumber,
    sipUsername,
    sipPassword,
    sipServerTcp: `sip:${SIP_DOMAIN}:${SIP_TCP_PORT};transport=tcp`,
    sipServerTls: `sip:${SIP_DOMAIN}:${SIP_TLS_PORT};transport=tls`,
    sipUri: `sip:${sipUsername}@${SIP_DOMAIN}`,
    mediaEncryption: "allowed",
    allowedNumbers: [],
    allowedSourceIps: ["0.0.0.0/0"],
    remoteDomains: [],
    authUsername: sipUsername,
    authPassword: sipPassword,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    active: true,
  };

  trunkStore.set(id, trunk);
  return trunk;
}

export function getTrunk(userId: string): SipTrunkConfig | null {
  const trunk = Array.from(trunkStore.values()).find(
    (t) => t.userId === userId && t.active
  );
  return trunk || null;
}

export function updateTrunkConfig(
  userId: string,
  updates: {
    mediaEncryption?: "allowed" | "required" | "disabled";
    allowedNumbers?: string[];
    allowedSourceIps?: string[];
    remoteDomains?: string[];
    authUsername?: string;
    authPassword?: string;
    phoneNumber?: string;
  }
): SipTrunkConfig | null {
  const trunk = Array.from(trunkStore.values()).find(
    (t) => t.userId === userId && t.active
  );
  if (!trunk) return null;

  if (updates.mediaEncryption !== undefined) trunk.mediaEncryption = updates.mediaEncryption;
  if (updates.allowedNumbers !== undefined) trunk.allowedNumbers = updates.allowedNumbers;
  if (updates.allowedSourceIps !== undefined) trunk.allowedSourceIps = updates.allowedSourceIps;
  if (updates.remoteDomains !== undefined) trunk.remoteDomains = updates.remoteDomains;
  if (updates.authUsername !== undefined) trunk.authUsername = updates.authUsername;
  if (updates.authPassword !== undefined) trunk.authPassword = updates.authPassword;
  if (updates.phoneNumber !== undefined) trunk.phoneNumber = updates.phoneNumber;

  return trunk;
}

export function regenerateTrunk(userId: string, phoneNumber: string): SipTrunkConfig {
  for (const [key, t] of trunkStore.entries()) {
    if (t.userId === userId) {
      trunkStore.delete(key);
    }
  }
  return generateTrunk(userId, phoneNumber);
}

export function revokeTrunk(userId: string): boolean {
  let found = false;
  for (const [key, t] of trunkStore.entries()) {
    if (t.userId === userId) {
      trunkStore.delete(key);
      found = true;
    }
  }
  return found;
}

export function validateTrunkAuth(username: string, password: string): SipTrunkConfig | null {
  for (const t of trunkStore.values()) {
    if (t.authUsername === username && t.authPassword === password && t.active) {
      t.lastUsed = new Date().toISOString();
      return t;
    }
  }
  return null;
}
