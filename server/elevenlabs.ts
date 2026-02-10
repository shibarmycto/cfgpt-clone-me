const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY environment variable is not configured");
  }
  return key;
}

export async function cloneVoice(
  name: string,
  audioBuffer: Buffer,
  description?: string
): Promise<{ voiceId: string; name: string }> {
  const apiKey = getApiKey();

  const formData = new FormData();
  formData.append("name", name);
  if (description) {
    formData.append("description", description);
  }

  const blob = new Blob([audioBuffer as unknown as ArrayBuffer], { type: "audio/mpeg" });
  formData.append("files", blob, "voice_sample.mp3");

  const response = await fetch(`${ELEVENLABS_API_BASE}/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs voice cloning failed (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as { voice_id: string };

  return {
    voiceId: data.voice_id,
    name,
  };
}

export async function listVoices(): Promise<
  Array<{ voice_id: string; name: string; category: string }>
> {
  const apiKey = getApiKey();

  const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    method: "GET",
    headers: {
      "xi-api-key": apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs list voices failed (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as {
    voices: Array<{ voice_id: string; name: string; category: string }>;
  };

  return data.voices.filter((voice) => voice.category === "cloned");
}

export async function deleteVoice(voiceId: string): Promise<boolean> {
  const apiKey = getApiKey();

  const response = await fetch(`${ELEVENLABS_API_BASE}/voices/${voiceId}`, {
    method: "DELETE",
    headers: {
      "xi-api-key": apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs delete voice failed (${response.status}): ${errorText}`
    );
  }

  return true;
}

export async function textToSpeech(
  voiceId: string,
  text: string
): Promise<Buffer> {
  const apiKey = getApiKey();

  const response = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs text-to-speech failed (${response.status}): ${errorText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
