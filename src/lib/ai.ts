import { withRetry } from './pool';

export type TranslationStyle = 'chuẩn' | 'genz';
export type VoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

interface ApiError extends Error {
  status?: number;
}

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
    } catch {
      /* ignore non-JSON error bodies */
    }
    const err: ApiError = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function translateText(text: string, style: TranslationStyle): Promise<string> {
  const { translated } = await withRetry(() =>
    postJSON<{ translated: string }>('/api/translate', { text, style }),
  );
  return translated || '';
}

// Build a WAV Blob from raw PCM (16-bit little endian, mono) so it can be cached.
export function pcmToWavBlob(pcmData: Uint8Array, sampleRate = 24000): Blob {
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + pcmData.length, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // chunk length
  view.setUint16(20, 1, true); // format (1 = PCM)
  view.setUint16(22, 1, true); // channels (1)
  view.setUint32(24, sampleRate, true); // sample rate
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmData.length, true); // data length

  return new Blob([wavHeader, pcmData], { type: 'audio/wav' });
}

export function createWavBlobUrlFromPCM(pcmData: Uint8Array, sampleRate = 24000): string {
  return URL.createObjectURL(pcmToWavBlob(pcmData, sampleRate));
}

export async function generateRawTTS(text: string, voiceName: VoiceName): Promise<Uint8Array> {
  const { audio } = await withRetry(() =>
    postJSON<{ audio: string }>('/api/tts', { text, voiceName }),
  );
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
  const pcmData = await generateRawTTS(text, voiceName);
  return createWavBlobUrlFromPCM(pcmData, 24000);
}
