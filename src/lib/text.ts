// Split long translated text into TTS-friendly chunks on sentence boundaries,
// so a single very long page doesn't exceed the TTS model's input limits.
export function chunkText(text: string, maxChars = 600): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.split(/(?<=[.!?…])\s+|\n+/).filter((s) => s.trim());
  const chunks: string[] = [];
  let cur = '';

  for (const sentence of sentences) {
    const s = sentence.trim();
    // A single sentence longer than the limit gets hard-split.
    if (s.length > maxChars) {
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars));
      continue;
    }
    if (cur && cur.length + s.length + 1 > maxChars) {
      chunks.push(cur);
      cur = '';
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
