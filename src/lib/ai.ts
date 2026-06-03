import { GoogleGenAI, Modality } from "@google/genai";

const getAI = () => {
  const apiKey = (process.env as any).GEMINI_API_KEY;
  if (!apiKey) {
     throw new Error("Missing Gemini API Key");
  }
  return new GoogleGenAI({ apiKey });
};

export type TranslationStyle = 'chuẩn' | 'genz';
export type VoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export async function translateText(text: string, style: TranslationStyle): Promise<string> {
  const ai = getAI();
  
  let systemInstruction = "";
  if (style === 'chuẩn') {
    systemInstruction = "Bạn là một biên dịch viên chuyên nghiệp. Hãy dịch văn bản được cung cấp sang tiếng Việt một cách chuẩn xác, bám sát nghĩa gốc. \n\nSỬ DỤNG ĐỊNH DẠNG MARKDOWN:\n- Dùng ## cho các tiêu đề chương hoặc đề mục lớn.\n- Dùng **bold** cho các khái niệm quan trọng hoặc thuật ngữ chính.\n- Dùng dấu - cho các danh sách liệt kê.\n- Nếu có chú thích dịch thuật, hãy đặt chúng trong một khối trích dẫn (using >). \n\nGiữ nguyên cấu trúc văn bản gốc nhưng làm nổi bật các phần bằng Markdown.";
  } else {
    systemInstruction = `Bạn là một người trẻ Gen Z Việt Nam chính hiệu. Hãy dịch văn bản được cung cấp sang tiếng Việt theo phong cách của Gen Z: dùng các từ lóng tiếng Việt tự nhiên (như "ảo ma", "bất ổn", "cảm lạnh", "keo lỳ", "hết cứu", "chằm zn", v.v.), giọng văn hài hước, thoải mái và năng động.

PHẢI TUÂN THỦ NGHIÊM NGẶT CÁC QUY TẮC SAU ĐỂ KHÔNG BỊ "Ô DỀ":

1. TIẾNG ANH (SLANG):
- HẠN CHẾ TỐI ĐA tiếng Anh lai tạp. Hãy dùng từ lóng thuần Việt.
- CHỈ ĐƯỢC PHÉP dùng những từ tiếng Anh quá phổ thông như: ok, chill, vibe, flex, drama, crush, team. Đừng lạm dụng.
- Dứt khoát KHÔNG dùng những từ như: hype, slay, high-tech, combat, no hope, bad day, make sense, out of box... (Hãy dùng "hào hứng", "đỉnh", "công nghệ cao", "đối đầu/cãi cọ", "hết cửa", "ngày xu cà na", "hợp lý", "sáng tạo").
- Người Mới học tiếng Anh cũng phải hiểu 100% bản dịch.

2. EMOJI (BẮT BUỘC):
- Dùng TỐI ĐA 2 EMOJI cho TOÀN BỘ MỘT ĐOẠN DỊCH (segment). KHÔNG ĐƯỢC dùng quá 2.
- KHÔNG BAO GIỜ đặt nhiều emoji đứng sát nhau (ví dụ: 😭😭 bỏ ngay).
- Chỉ cho phép đặt emoji ở cuối câu để tạo cảm xúc, tuyệt đối không chèn vào giữa câu hay thay thế chữ.

3. MARKDOWN:
- Dùng ## cho các câu tiêu đề.
- Dùng **bold** để nhấn mạnh các thông tin quan trọng.
- Dùng dấu gạch ngang ( - ) cho danh sách. (Không dùng emoji làm bullet point).
- Dùng blockquote (>) nếu cần tóm tắt hoặc bình luận vui.

Văn phong trẻ trung, gần gũi nhưng vẫn phải truyền đạt CHÍNH XÁC 100% thông điệp và ý nghĩa của văn bản gốc.`;
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `[VĂN BẢN CẦN DỊCH]\n${text}`,
    config: {
      systemInstruction,
      temperature: 0.7,
    }
  });

  return response.text?.trim() || "";
}

// Split long text into TTS-safe chunks on paragraph/sentence boundaries.
const TTS_CHUNK_CHARS = 1800;
export function chunkText(text: string, maxChars: number = TTS_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed.split(/\n\s*\n/);
  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      pieces.push(para);
      continue;
    }
    // Paragraph too long: split on sentence boundaries (Vietnamese + common punctuation)
    const sentences = para.split(/(?<=[.!?…。])\s+/);
    for (const sentence of sentences) {
      if (sentence.length <= maxChars) {
        pieces.push(sentence);
      } else {
        // Last resort: hard-slice an oversized sentence
        for (let i = 0; i < sentence.length; i += maxChars) {
          pieces.push(sentence.slice(i, i + maxChars));
        }
      }
    }
  }

  // Greedily pack pieces into <= maxChars chunks
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

// Concatenate multiple raw PCM buffers into one.
export function concatPcm(buffers: Uint8Array[]): Uint8Array {
  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    combined.set(b, offset);
    offset += b.length;
  }
  return combined;
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
  const ai = getAI();
  
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
     throw new Error("Không thể tạo audio từ văn bản.");
  }

  const binaryStr = atob(base64Audio);
  const pcmData = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
      pcmData[i] = binaryStr.charCodeAt(i);
  }
  return pcmData;
}

// Generate TTS for arbitrarily long text by chunking, then concatenating PCM.
export async function generateRawTTSChunked(
  text: string,
  voiceName: VoiceName,
  opts?: { sleepMs?: number; onProgress?: (done: number, total: number) => void }
): Promise<Uint8Array> {
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error("Không có nội dung để đọc.");
  }
  const buffers: Uint8Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0 && opts?.sleepMs) {
      await new Promise(r => setTimeout(r, opts.sleepMs));
    }
    buffers.push(await generateRawTTS(chunks[i], voiceName));
    opts?.onProgress?.(i + 1, chunks.length);
  }
  return concatPcm(buffers);
}

export async function generateTTS(text: string, voiceName: VoiceName): Promise<string> {
  // Assuming Gemini TTS returns 24000Hz by default
  const pcmData = await generateRawTTSChunked(text, voiceName, { sleepMs: 1000 });
  return createWavBlobUrlFromPCM(pcmData, 24000);
}
