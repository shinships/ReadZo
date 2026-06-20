import { ParsedPDF, OutlineItem, parsePDF } from './pdf';
import { chunkText } from './ai';

export type DocFormat = 'pdf' | 'docx' | 'txt';

export interface ParsedDocument {
  format: DocFormat;
  fileName: string;
  numPages: number;          // pdf: trang thật; docx/txt: số pseudo-page
  textByPage: string[];      // length === numPages
  outline: OutlineItem[];    // chỉ pdf; [] cho docx/txt
  pdf?: ParsedPDF;           // chỉ pdf — phục vụ canvas preview
}

// Kích thước pseudo-page cho định dạng không phân trang (tối ưu độ trễ dịch, KHÔNG phải giới hạn TTS)
const PSEUDO_PAGE_CHARS = 3000;

export function detectFormat(file: File): DocFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'txt';
  return null;
}

// Tách văn bản dài thành các "pseudo-page" theo ranh giới đoạn văn.
export function splitIntoPseudoPages(text: string, maxChars: number = PSEUDO_PAGE_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [''];

  const paragraphs = trimmed.split(/\n\s*\n/);
  const pages: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // Đoạn quá dài: dùng lại chunkText để cắt theo câu
      if (current.trim()) {
        pages.push(current);
        current = '';
      }
      for (const piece of chunkText(para, maxChars)) {
        pages.push(piece);
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxChars && current) {
      pages.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) pages.push(current);
  return pages.length > 0 ? pages : [''];
}

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const format = detectFormat(file);
  if (!format) {
    throw new Error('Định dạng không được hỗ trợ. Vui lòng chọn PDF, DOCX hoặc TXT.');
  }

  try {
    if (format === 'pdf') {
      const pdf = await parsePDF(file);
      return {
        format,
        fileName: file.name,
        numPages: pdf.numPages,
        textByPage: pdf.textByPage,
        outline: pdf.outline,
        pdf,
      };
    }

    let text = '';
    if (format === 'docx') {
      // Dynamic import để PDF/TXT không gánh bundle của mammoth
      const mammoth = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      text = result.value;
    } else {
      text = await file.text();
    }

    const textByPage = splitIntoPseudoPages(text);
    return {
      format,
      fileName: file.name,
      numPages: textByPage.length,
      textByPage,
      outline: [],
    };
  } catch (error) {
    console.error('Error parsing document:', error);
    throw new Error(`Không thể đọc tài liệu. Lỗi: ${(error as Error).message}`);
  }
}
