import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ParsedPDF } from './lib/pdf';

export default function PDFPagePreview({
  parsedPdf,
  currentPage,
}: {
  parsedPdf: ParsedPDF;
  currentPage?: number;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPageNumber(1);
  }, [parsedPdf]);

  useEffect(() => {
    if (currentPage && currentPage >= 1 && currentPage <= parsedPdf.numPages) {
      setPageNumber(currentPage);
    }
  }, [currentPage, parsedPdf]);

  useEffect(() => {
    let renderTask: any;
    let isCancelled = false;

    const renderPage = async () => {
      if (!parsedPdf?.pdfDoc || !canvasRef.current || !containerRef.current) return;
      try {
        const page = await parsedPdf.pdfDoc.getPage(pageNumber);
        if (isCancelled) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const _viewport = page.getViewport({ scale: 1 });
        const parentWidth = containerRef.current.clientWidth - 16;
        const scale = parentWidth / _viewport.width;
        const viewport = page.getViewport({ scale: Math.max(scale, 0.5) });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        renderTask = page.render({ canvasContext: ctx, viewport } as any);
        await renderTask.promise;
      } catch (e) {
        console.log('Render cancelled or failed');
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [parsedPdf, pageNumber]);

  if (!parsedPdf) return null;

  return (
    <div className="bg-white border-2 border-black p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2 shrink-0">
      <div className="flex justify-between items-center bg-gray-100 border-2 border-black p-1">
        <button
          onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
          disabled={pageNumber <= 1}
          className="p-1 hover:bg-black hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[10px] font-black uppercase tracking-widest">
          Trang {pageNumber} / {parsedPdf.numPages}
        </span>
        <button
          onClick={() => setPageNumber((p) => Math.min(parsedPdf.numPages, p + 1))}
          disabled={pageNumber >= parsedPdf.numPages}
          className="p-1 hover:bg-black hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div
        ref={containerRef}
        className="w-full flex justify-center bg-gray-50 border-2 border-black overflow-auto"
        style={{ maxHeight: '400px' }}
      >
        <canvas ref={canvasRef} className="max-w-full" />
      </div>
    </div>
  );
}
