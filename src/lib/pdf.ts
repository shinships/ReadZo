import * as pdfjsLib from 'pdfjs-dist';
// @ts-expect-error - Vite specific import
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Use local worker to avoid Vite build issues and version mismatches with pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface OutlineItem {
  title: string;
  pageNumber: number;
}

export interface ParsedPDF {
  numPages: number;
  outline: OutlineItem[];
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  docHash: string;
}

// SHA-256 (hex) of the file bytes — a stable identity for the document so saved
// progress re-links to the same PDF regardless of filename.
export async function computeDocHash(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Extract plain text for a single page, on demand. Avoids parsing every page up
// front for large PDFs when only a small range is being translated.
export async function extractPageText(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNo: number,
): Promise<string> {
  const page = await pdfDoc.getPage(pageNo);
  const textContent = await page.getTextContent();
  return textContent.items.map((item: any) => item.str).join(' ');
}

export async function parsePDF(file: File): Promise<ParsedPDF> {
  const arrayBuffer = await file.arrayBuffer();
  // Hash before handing the buffer to pdf.js (which may transfer/detach it).
  const docHash = await computeDocHash(arrayBuffer);
  const typedArray = new Uint8Array(arrayBuffer);

  const loadingTask = pdfjsLib.getDocument({ data: typedArray });

  try {
    const pdfDoc = await loadingTask.promise;

    const pdfOutput: ParsedPDF = {
      numPages: pdfDoc.numPages,
      outline: [],
      pdfDoc,
      docHash,
    };

    // Try to get outline (table of contents)
    try {
      const outline = await pdfDoc.getOutline();
      if (outline) {
        for (const item of outline) {
          if (item.dest) {
            let dest = item.dest;
            if (typeof dest === 'string') {
              dest = await pdfDoc.getDestination(dest);
            }
            if (Array.isArray(dest)) {
              try {
                const pageRef = dest[0];
                const pageIndex = await pdfDoc.getPageIndex(pageRef);
                pdfOutput.outline.push({
                  title: item.title,
                  pageNumber: pageIndex + 1, // 1-based
                });
              } catch (e) {
                console.log('Could not resolve page index for outline item', item.title);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to get outline', e);
    }

    return pdfOutput;
  } catch (error) {
    console.error('Error parsing PDF details:', error);
    throw new Error(`Không thể đọc file PDF. Lỗi: ${(error as Error).message}`);
  }
}
