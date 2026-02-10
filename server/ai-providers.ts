import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export interface AiProviderConfig {
  id: string;
  name: string;
  type: "replit" | "openai" | "claude" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model: string;
  isActive: boolean;
}

export interface ImageGenConfig {
  provider: "openai" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

export interface VideoGenConfig {
  provider: "luma" | "openai" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

const envOpenAIKey = process.env.OPENAI_API_KEY || "";
const envAnthropicKey = process.env.ANTHROPIC_API_KEY || "";

const DEFAULT_PROVIDERS: AiProviderConfig[] = [
  {
    id: "claude",
    name: "Claude AI",
    type: "claude",
    apiKey: envAnthropicKey,
    model: "claude-sonnet-4-20250514",
    isActive: !!envAnthropicKey,
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    apiKey: envOpenAIKey,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    isActive: !!envOpenAIKey,
  },
  {
    id: "replit",
    name: "Default AI",
    type: "replit",
    model: "gpt-5-nano",
    isActive: true,
  },
  {
    id: "custom",
    name: "Custom Endpoint",
    type: "custom",
    apiKey: "",
    baseUrl: "",
    model: "",
    isActive: false,
  },
];

let providerConfigs: AiProviderConfig[] = [...DEFAULT_PROVIDERS];

let imageGenConfig: ImageGenConfig = {
  provider: "openai",
  apiKey: envOpenAIKey,
  baseUrl: "https://api.openai.com/v1",
  model: "dall-e-3",
  enabled: !!envOpenAIKey,
};

const envLumaKey = process.env.LUMA_API_KEY || "";

let videoGenConfig: VideoGenConfig = {
  provider: "luma",
  apiKey: envLumaKey || envOpenAIKey,
  baseUrl: "https://api.lumalabs.ai/dream-machine/v1",
  model: "ray-2",
  enabled: !!(envLumaKey || envOpenAIKey),
};

export function getProviders(): AiProviderConfig[] {
  return providerConfigs.map((p) => ({
    ...p,
    apiKey: p.apiKey ? "***configured***" : "",
  }));
}

export function getProvidersRaw(): AiProviderConfig[] {
  return [...providerConfigs];
}

export function updateProvider(config: AiProviderConfig): void {
  const idx = providerConfigs.findIndex((p) => p.id === config.id);
  if (idx >= 0) {
    const existing = providerConfigs[idx];
    if (config.apiKey === "***configured***") {
      config.apiKey = existing.apiKey;
    }
    providerConfigs[idx] = config;
  } else {
    providerConfigs.push(config);
  }
}

export function setActiveProvider(id: string): void {
  providerConfigs = providerConfigs.map((p) => ({
    ...p,
    isActive: p.id === id,
  }));
}

export function getActiveProvider(): AiProviderConfig {
  return (
    providerConfigs.find((p) => p.isActive) || providerConfigs[0]
  );
}

export function addProvider(config: AiProviderConfig): void {
  const existing = providerConfigs.findIndex((p) => p.id === config.id);
  if (existing >= 0) {
    providerConfigs[existing] = config;
  } else {
    providerConfigs.push(config);
  }
}

export function removeProvider(id: string): void {
  if (id === "replit") return;
  providerConfigs = providerConfigs.filter((p) => p.id !== id);
  if (!providerConfigs.find((p) => p.isActive)) {
    providerConfigs[0].isActive = true;
  }
}

export function getImageGenConfig(): ImageGenConfig {
  return { ...imageGenConfig, apiKey: imageGenConfig.apiKey ? "***configured***" : "" };
}

export function getImageGenConfigRaw(): ImageGenConfig {
  return { ...imageGenConfig };
}

export function updateImageGenConfig(config: Partial<ImageGenConfig>): void {
  if (config.apiKey && config.apiKey !== "***configured***") {
    imageGenConfig.apiKey = config.apiKey;
  }
  if (config.baseUrl !== undefined) imageGenConfig.baseUrl = config.baseUrl;
  if (config.model !== undefined) imageGenConfig.model = config.model;
  if (config.provider !== undefined) imageGenConfig.provider = config.provider;
  if (config.enabled !== undefined) imageGenConfig.enabled = config.enabled;
}

export function getVideoGenConfig(): VideoGenConfig {
  return { ...videoGenConfig, apiKey: videoGenConfig.apiKey ? "***configured***" : "" };
}

export function getVideoGenConfigRaw(): VideoGenConfig {
  return { ...videoGenConfig };
}

export function updateVideoGenConfig(config: Partial<VideoGenConfig>): void {
  if (config.apiKey && config.apiKey !== "***configured***") {
    videoGenConfig.apiKey = config.apiKey;
  }
  if (config.baseUrl !== undefined) videoGenConfig.baseUrl = config.baseUrl;
  if (config.model !== undefined) videoGenConfig.model = config.model;
  if (config.provider !== undefined) videoGenConfig.provider = config.provider;
  if (config.enabled !== undefined) videoGenConfig.enabled = config.enabled;
}

export interface ChatProviderInfo {
  id: string;
  name: string;
  type: string;
  available: boolean;
  model: string;
}

export function getChatProviders(): ChatProviderInfo[] {
  return providerConfigs
    .filter((p) => p.id !== "custom" || (p.apiKey && p.baseUrl))
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      available: p.type === "replit" ? true : !!p.apiKey,
      model: p.model,
    }));
}

export function getProviderFallbackOrder(): string[] {
  const order: string[] = [];
  const claude = providerConfigs.find((p) => p.type === "claude" && p.apiKey);
  if (claude) order.push(claude.id);
  const openai = providerConfigs.find((p) => p.type === "openai" && p.apiKey);
  if (openai) order.push(openai.id);
  const replit = providerConfigs.find((p) => p.type === "replit");
  if (replit) order.push(replit.id);
  return order;
}

function getOpenAIClient(provider: AiProviderConfig): OpenAI {
  if (provider.type === "replit") {
    return new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }

  return new OpenAI({
    apiKey: provider.apiKey || "",
    baseURL: provider.baseUrl || "https://api.openai.com/v1",
  });
}

function getAnthropicClient(provider: AiProviderConfig): Anthropic {
  return new Anthropic({
    apiKey: provider.apiKey || envAnthropicKey,
  });
}

async function* streamClaudeChat(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  provider: AiProviderConfig
): AsyncGenerator<{ choices: [{ delta: { content?: string } }] }> {
  const client = getAnthropicClient(provider);

  const filteredMessages = messages.filter((m) => m.role !== "system");

  const stream = client.messages.stream({
    model: provider.model || "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: filteredMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield {
        choices: [{ delta: { content: event.delta.text } }],
      };
    }
  }
}

export async function streamChat(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  providerId?: string
): Promise<AsyncIterable<any>> {
  const provider = providerId
    ? providerConfigs.find((p) => p.id === providerId) || getActiveProvider()
    : getActiveProvider();

  if (provider.type === "claude") {
    return streamClaudeChat(messages, systemPrompt, provider);
  }

  const client = getOpenAIClient(provider);

  const isGpt5 = provider.model.startsWith("gpt-5") || provider.model.startsWith("o");
  const tokenParam = isGpt5
    ? { max_completion_tokens: 4096 }
    : { max_tokens: 4096 };

  const stream = await client.chat.completions.create({
    model: provider.model,
    messages: [
      { role: "system", content: systemPrompt },
      ...(messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]),
    ],
    stream: true,
    ...tokenParam,
  });

  return stream;
}

function resolveImageApiKey(): { apiKey: string; baseUrl: string } | null {
  const config = getImageGenConfigRaw();
  if (config.enabled && config.apiKey) {
    return { apiKey: config.apiKey, baseUrl: config.baseUrl || "https://api.openai.com/v1" };
  }
  const openaiEnv = process.env.OPENAI_API_KEY;
  if (openaiEnv) {
    return { apiKey: openaiEnv, baseUrl: "https://api.openai.com/v1" };
  }
  const openaiProvider = providerConfigs.find((p) => p.type === "openai" && p.apiKey);
  if (openaiProvider?.apiKey) {
    return { apiKey: openaiProvider.apiKey, baseUrl: openaiProvider.baseUrl || "https://api.openai.com/v1" };
  }
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const replitBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (replitKey && replitBase) {
    return { apiKey: replitKey, baseUrl: replitBase };
  }
  return null;
}

export async function generateImage(
  prompt: string,
  size: string = "1024x1024"
): Promise<{ url?: string; b64?: string; error?: string }> {
  const config = getImageGenConfigRaw();
  const resolved = resolveImageApiKey();

  if (!resolved) {
    return {
      error: "Image generation is not configured. Please set up an OpenAI API key in Admin > AI Providers > Image Generation to enable this feature.",
    };
  }

  const client = new OpenAI({
    apiKey: resolved.apiKey,
    baseURL: resolved.baseUrl,
  });

  try {
    const model = (config.enabled && config.model) ? config.model : "dall-e-3";
    const params: any = {
      model,
      prompt,
      n: 1,
      size: size,
    };

    if (!model.includes("gpt-image")) {
      params.response_format = "b64_json";
    }

    const response = await client.images.generate(params);

    const imageData = response.data?.[0];
    if (imageData?.b64_json) {
      return { b64: imageData.b64_json };
    } else if (imageData?.url) {
      return { url: imageData.url };
    }

    return { error: "No image data returned" };
  } catch (err: any) {
    return { error: err.message || "Image generation failed" };
  }
}

async function generateVideoWithLuma(
  prompt: string,
  apiKey: string,
  model: string
): Promise<{ videoUrl?: string; error?: string }> {
  const createRes = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      model: model || "ray-2",
      aspect_ratio: "16:9",
    }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text();
    return { error: `Luma API error: ${createRes.status} - ${errBody}` };
  }

  const createData = await createRes.json() as any;
  const generationId = createData.id;

  if (!generationId) {
    return { error: "Failed to start video generation - no generation ID returned" };
  }

  const maxWaitMs = 5 * 60 * 1000;
  const pollInterval = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const statusRes = await fetch(
      `https://api.lumalabs.ai/dream-machine/v1/generations/${generationId}`,
      {
        headers: {
          "authorization": `Bearer ${apiKey}`,
          "accept": "application/json",
        },
      }
    );

    if (!statusRes.ok) continue;

    const statusData = await statusRes.json() as any;

    if (statusData.state === "completed") {
      const videoUrl = statusData.assets?.video;
      if (videoUrl) {
        return { videoUrl };
      }
      return { error: "Video completed but no URL returned" };
    }

    if (statusData.state === "failed") {
      return { error: statusData.failure_reason || "Video generation failed" };
    }
  }

  return { error: "Video generation timed out after 5 minutes. Please try again." };
}

export async function generateVideoFromText(
  prompt: string
): Promise<{ url?: string; b64?: string; videoUrl?: string; storyboard?: string; error?: string }> {
  const config = getVideoGenConfigRaw();

  const lumaKey = process.env.LUMA_API_KEY || "";
  const apiKey = (config.enabled && config.apiKey) ? config.apiKey : lumaKey;
  const provider = (config.enabled && config.provider) ? config.provider : (lumaKey ? "luma" : "openai");

  if (!apiKey) {
    return {
      error: "Video generation is not configured. Please set up an API key in Admin > AI Providers > Video Generation to enable this feature.",
    };
  }

  if (provider === "luma") {
    try {
      const result = await generateVideoWithLuma(prompt, apiKey, config.model || "ray-2");
      if (result.error) {
        return { error: result.error };
      }
      return { videoUrl: result.videoUrl };
    } catch (err: any) {
      return { error: err.message || "Luma video generation failed" };
    }
  }

  const openaiKey = (config.enabled && config.apiKey) ? config.apiKey : (process.env.OPENAI_API_KEY || "");
  if (!openaiKey) {
    return { error: "No API key available for video generation" };
  }

  const client = new OpenAI({
    apiKey: openaiKey,
    baseURL: config.baseUrl || "https://api.openai.com/v1",
  });

  try {
    const storyboardResponse = await client.chat.completions.create({
      model: config.model || "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a professional video storyboard creator. Given a prompt, create a detailed 3-scene storyboard for a short social media video. For each scene, describe: the visual content, camera angle, lighting, mood, and any text overlays. Keep it concise but vivid. Format as Scene 1, Scene 2, Scene 3.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
    });

    const storyboard = storyboardResponse.choices[0]?.message?.content || "";

    const imageResponse = await client.images.generate({
      model: "dall-e-3",
      prompt: `Create a cinematic, high-quality key frame image for a social media video about: ${prompt}. Style: professional, vivid colors, cinematic lighting, 16:9 aspect ratio composition.`,
      n: 1,
      size: "1792x1024",
      response_format: "b64_json",
    });

    const imageData = imageResponse.data?.[0];
    const b64 = imageData?.b64_json;

    return {
      b64: b64 || undefined,
      storyboard,
    };
  } catch (err: any) {
    return { error: err.message || "Video generation failed" };
  }
}

export async function generateCompletion(
  prompt: string,
  systemPrompt: string,
  providerId?: string
): Promise<string> {
  const fallback = getProviderFallbackOrder();
  const targetId = providerId || fallback[0] || "replit";
  const provider = providerConfigs.find((p) => p.id === targetId) || getActiveProvider();

  if (provider.type === "claude") {
    try {
      const client = getAnthropicClient(provider);
      const response = await client.messages.create({
        model: provider.model || "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((b: any) => b.type === "text");
      return (textBlock as any)?.text || "";
    } catch (err: any) {
      console.error("Claude completion failed, trying fallback:", err.message);
      const nextProvider = fallback.find((id) => id !== targetId);
      if (nextProvider) return generateCompletion(prompt, systemPrompt, nextProvider);
      throw err;
    }
  }

  const client = getOpenAIClient(provider);

  const isGpt5 = provider.model.startsWith("gpt-5") || provider.model.startsWith("o");
  const tokenParam = isGpt5
    ? { max_completion_tokens: 1024 }
    : { max_tokens: 1024 };

  const response = await client.chat.completions.create({
    model: provider.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    ...tokenParam,
  });

  return response.choices[0]?.message?.content || "";
}
