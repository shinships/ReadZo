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
  textByPage: string[];
  outline: OutlineItem[];
  pdfDoc: pdfjsLib.PDFDocumentProxy;
}

export async function parsePDF(file: File): Promise<ParsedPDF> {
  const arrayBuffer = await file.arrayBuffer();
  const typedArray = new Uint8Array(arrayBuffer);
  
  const loadingTask = pdfjsLib.getDocument({ data: typedArray });
  
  try {
    const pdfDoc = await loadingTask.promise;
    
    const pdfOutput: ParsedPDF = {
      numPages: pdfDoc.numPages,
      textByPage: [],
      outline: [],
      pdfDoc: pdfDoc,
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
                // getPageIndex is not always straightforward, alternative is getDestinations
                // For simplicity, we might try to get the page index
                try {
                   const pageRef = dest[0];
                   const pageIndex = await pdfDoc.getPageIndex(pageRef);
                   pdfOutput.outline.push({
                      title: item.title,
                      pageNumber: pageIndex + 1, // 1-based
                   });
                } catch(e) {
                   console.log("Could not resolve page index for outline item", item.title);
                }
             }
          }
        }
      }
    } catch (e) {
      console.warn("Failed to get outline", e);
    }

    // Extract text from all pages
    // Doing this in parallel might be too memory intensive for large PDFs, so we batch it
    const batchSize = 10;
    for (let i = 1; i <= pdfOutput.numPages; i += batchSize) {
      const promises = [];
      for (let j = 0; j < batchSize && i + j <= pdfOutput.numPages; j++) {
         const pageNum = i + j;
         promises.push(
            pdfDoc.getPage(pageNum).then(async (page) => {
               const textContent = await page.getTextContent();
               const textItems = textContent.items.map((item: any) => item.str);
               return { pageNum, text: textItems.join(' ') };
            })
         );
      }
      const results = await Promise.all(promises);
      for (const res of results) {
         pdfOutput.textByPage[res.pageNum - 1] = res.text;
      }
    }

    return pdfOutput;
  } catch (error) {
    console.error("Error parsing PDF details:", error);
    throw new Error(`Không thể đọc file PDF. Lỗi: ${(error as Error).message}`);
  }
}
