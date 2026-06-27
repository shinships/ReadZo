export type TranslationStyle = 'chuẩn' | 'genz';
export type VoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch { /* ignore non-JSON error bodies */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function translateText(text: string, style: TranslationStyle): Promise<string> {
  const { translated } = await postJSON<{ translated: string }>('/api/translate', { text, style });
  return translated || '';
}

// Convert raw PCM (16-bit little endian, mono, expected from TTS) to WAV Blob URL
export function createWavBlobUrlFromPCM(pcmData: Uint8Array, sampleRate: number = 24000): string {
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // "RIFF"
    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + pcmData.length, true);
    // "WAVE"
    view.setUint32(8, 0x57415645, false);
    // "fmt " chunk
    view.setUint32(12, 0x666D7420, false);
    view.setUint32(16, 16, true); // chunk length
    view.setUint16(20, 1, true); // format (1 = PCM)
    view.setUint16(22, 1, true); // channels (1)
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    // "data" chunk
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, pcmData.length, true); // data length

    const blob = new Blob([wavHeader, pcmData], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
}

export async function generateRawTTS(text: string, voiceName: VoiceName): Promise<Uint8Array> {
  const { audio } = await postJSON<{ audio: string }>('/api/tts', { text, voiceName });
  if (!audio) {
    throw new Error('Không thể tạo audio từ văn bản.');
  }

  const binaryStr = atob(audio);
  const pcmData = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
      pcmData[i] = binaryStr.charCodeAt(i);
  }
  return pcmData;
}

export async function generateTTS(text: string, voiceName: VoiceName): Promise<string> {
  // Assuming Gemini TTS returns 24000Hz by default
  const pcmData = await generateRawTTS(text, voiceName);
  return createWavBlobUrlFromPCM(pcmData, 24000);
}
