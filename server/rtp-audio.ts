import * as dgram from "node:dgram";
import * as crypto from "node:crypto";

export interface RemoteRtpEndpoint {
  ip: string;
  port: number;
}

export function parseSdpRemoteEndpoint(sdp: string): RemoteRtpEndpoint | null {
  if (!sdp) return null;
  const cLine = sdp.match(/c=IN IP4\s+(\S+)/);
  const mLine = sdp.match(/m=audio\s+(\d+)/);
  if (cLine && mLine) {
    return { ip: cLine[1], port: parseInt(mLine[1]) };
  }
  return null;
}

export function linearToUlaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;

  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  let expMask = 0x4000;
  while (exponent > 0 && !(sample & expMask)) {
    exponent--;
    expMask >>= 1;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const ulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return ulawByte;
}

export function pcm16ToUlaw8k(pcmBuffer: Buffer, inputSampleRate: number = 24000): Buffer {
  const ratio = inputSampleRate / 8000;
  const inputSamples = pcmBuffer.length / 2;
  const outputSamples = Math.floor(inputSamples / ratio);
  const output = Buffer.alloc(outputSamples);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = Math.floor(i * ratio);
    const byteOffset = srcIndex * 2;
    if (byteOffset + 1 < pcmBuffer.length) {
      const sample = pcmBuffer.readInt16LE(byteOffset);
      output[i] = linearToUlaw(sample);
    } else {
      output[i] = 0xff;
    }
  }

  return output;
}

export function wavToUlaw8k(wavBuffer: Buffer): Buffer {
  let sampleRate = 24000;
  let dataOffset = 44;
  let bitsPerSample = 16;

  if (wavBuffer.length > 44 && wavBuffer.toString("ascii", 0, 4) === "RIFF") {
    sampleRate = wavBuffer.readUInt32LE(24);
    bitsPerSample = wavBuffer.readUInt16LE(34);

    let offset = 12;
    while (offset < wavBuffer.length - 8) {
      const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
      const chunkSize = wavBuffer.readUInt32LE(offset + 4);
      if (chunkId === "data") {
        dataOffset = offset + 8;
        break;
      }
      offset += 8 + chunkSize;
    }
  }

  const pcmData = wavBuffer.subarray(dataOffset);
  return pcm16ToUlaw8k(pcmData, sampleRate);
}

export function generateSilenceUlaw(durationMs: number): Buffer {
  const samples = Math.floor((durationMs / 1000) * 8000);
  const buffer = Buffer.alloc(samples);
  buffer.fill(0xff);
  return buffer;
}

const RTP_HEADER_SIZE = 12;
const SAMPLES_PER_PACKET = 160;
const PACKET_DURATION_MS = 20;

function createRtpPacket(
  payloadType: number,
  sequenceNumber: number,
  timestamp: number,
  ssrc: number,
  payload: Buffer,
  marker: boolean = false
): Buffer {
  const header = Buffer.alloc(RTP_HEADER_SIZE);
  header[0] = 0x80;
  header[1] = (marker ? 0x80 : 0x00) | (payloadType & 0x7f);
  header.writeUInt16BE(sequenceNumber & 0xffff, 2);
  header.writeUInt32BE(timestamp >>> 0, 4);
  header.writeUInt32BE(ssrc >>> 0, 8);

  return Buffer.concat([header, payload]);
}

export class RtpSession {
  private socket: dgram.Socket | null = null;
  private remoteEndpoint: RemoteRtpEndpoint;
  private sequenceNumber: number;
  private timestamp: number;
  private ssrc: number;
  private localPort: number = 0;
  private streaming: boolean = false;
  private closed: boolean = false;
  private log: (msg: string) => void;

  constructor(remote: RemoteRtpEndpoint, logFn?: (msg: string) => void) {
    this.remoteEndpoint = remote;
    this.sequenceNumber = Math.floor(Math.random() * 65535);
    this.timestamp = Math.floor(Math.random() * 0xffffffff);
    this.ssrc = crypto.randomBytes(4).readUInt32BE(0);
    this.log = logFn || ((msg: string) => console.log(`[RTP] ${msg}`));
  }

  async open(): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      this.socket = socket;

      socket.on("error", (err) => {
        this.log(`RTP socket error: ${err.message}`);
      });

      socket.on("message", (msg, rinfo) => {
        if (!this.streaming) {
          this.remoteEndpoint = { ip: rinfo.address, port: rinfo.port };
        }
      });

      socket.bind(0, () => {
        const addr = socket.address();
        this.localPort = addr.port;
        this.log(`RTP socket bound to port ${this.localPort}`);
        this.log(`RTP target: ${this.remoteEndpoint.ip}:${this.remoteEndpoint.port}`);
        resolve(this.localPort);
      });
    });
  }

  getLocalPort(): number {
    return this.localPort;
  }

  async streamAudio(ulawData: Buffer): Promise<void> {
    if (!this.socket || this.closed) {
      this.log("RTP session closed, cannot stream");
      return;
    }

    this.streaming = true;
    const totalPackets = Math.ceil(ulawData.length / SAMPLES_PER_PACKET);
    this.log(`Streaming ${ulawData.length} bytes of u-law audio (${totalPackets} RTP packets, ${(totalPackets * PACKET_DURATION_MS / 1000).toFixed(1)}s)`);

    let packetsSent = 0;

    for (let offset = 0; offset < ulawData.length; offset += SAMPLES_PER_PACKET) {
      if (this.closed) break;

      const end = Math.min(offset + SAMPLES_PER_PACKET, ulawData.length);
      let payload = ulawData.subarray(offset, end);

      if (payload.length < SAMPLES_PER_PACKET) {
        const padded = Buffer.alloc(SAMPLES_PER_PACKET, 0xff);
        payload.copy(padded);
        payload = padded;
      }

      const marker = offset === 0;
      const packet = createRtpPacket(
        0,
        this.sequenceNumber,
        this.timestamp,
        this.ssrc,
        payload,
        marker
      );

      try {
        await this.sendPacket(packet);
        packetsSent++;
      } catch (err: any) {
        this.log(`RTP send error: ${err.message}`);
        break;
      }

      this.sequenceNumber = (this.sequenceNumber + 1) & 0xffff;
      this.timestamp = (this.timestamp + SAMPLES_PER_PACKET) >>> 0;

      await this.sleep(PACKET_DURATION_MS);
    }

    this.streaming = false;
    this.log(`RTP streaming complete: ${packetsSent}/${totalPackets} packets sent`);
  }

  async sendSilence(durationMs: number): Promise<void> {
    const silenceData = generateSilenceUlaw(durationMs);
    await this.streamAudio(silenceData);
  }

  private sendPacket(packet: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.closed) {
        reject(new Error("Socket closed"));
        return;
      }
      this.socket.send(
        packet,
        0,
        packet.length,
        this.remoteEndpoint.port,
        this.remoteEndpoint.ip,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  close() {
    this.closed = true;
    this.streaming = false;
    try {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
    } catch {}
    this.log("RTP session closed");
  }
}
