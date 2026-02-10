export interface VoiceUpload {
  id: string;
  userId: string;
  name: string;
  audioBuffer: Buffer;
  mimeType: string;
  duration: number;
  createdAt: string;
  isActive: boolean;
}

const voiceSamples = new Map<string, VoiceUpload>();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

export function uploadVoiceSample(
  userId: string,
  name: string,
  audioBase64: string,
  mimeType: string
): VoiceUpload {
  const id = genId();
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const duration = 0;

  const sample: VoiceUpload = {
    id,
    userId,
    name,
    audioBuffer,
    mimeType,
    duration,
    createdAt: new Date().toISOString(),
    isActive: false,
  };

  voiceSamples.set(id, sample);
  return sample;
}

export function getUserVoiceSamples(userId: string): VoiceUpload[] {
  const results: VoiceUpload[] = [];
  for (const sample of voiceSamples.values()) {
    if (sample.userId === userId) {
      results.push(sample);
    }
  }
  return results;
}

export function getVoiceSample(id: string): VoiceUpload | null {
  return voiceSamples.get(id) || null;
}

export function getActiveVoiceSample(userId: string): VoiceUpload | null {
  for (const sample of voiceSamples.values()) {
    if (sample.userId === userId && sample.isActive) {
      return sample;
    }
  }
  return null;
}

export function setActiveVoiceSample(userId: string, sampleId: string): boolean {
  const target = voiceSamples.get(sampleId);
  if (!target || target.userId !== userId) return false;

  for (const sample of voiceSamples.values()) {
    if (sample.userId === userId) {
      sample.isActive = false;
    }
  }

  target.isActive = true;
  return true;
}

export function deleteVoiceSample(id: string): boolean {
  return voiceSamples.delete(id);
}

export function getVoiceSampleAudio(id: string): { buffer: Buffer; mimeType: string } | null {
  const sample = voiceSamples.get(id);
  if (!sample) return null;
  return { buffer: sample.audioBuffer, mimeType: sample.mimeType };
}
