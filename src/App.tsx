import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Play, Square, Pause, FastForward, History, ArrowRight, Settings2, Loader2, Volume2, Check, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { parsePDF, ParsedPDF, OutlineItem } from './lib/pdf';
import { translateText, generateTTS, generateRawTTS, createWavBlobUrlFromPCM, TranslationStyle, VoiceName } from './lib/ai';
import { motion, AnimatePresence } from 'motion/react';
import html2pdf from 'html2pdf.js';
import Markdown from 'react-markdown';


interface Segment {
  pageNumber: number;
  original: string;
  translated: string | null;
}

interface TranslationRecord {
  id: string;
  date: number;
  fileName: string;
  style: TranslationStyle;
  segments: Segment[];
}

function formatTime(seconds: number) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function PDFPagePreview({ parsedPdf, currentPage }: { parsedPdf: ParsedPDF, currentPage?: number }) {
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
             
             // Get viewport
             const _viewport = page.getViewport({ scale: 1 });
             // Scale it to fit the parent width
             const parentWidth = containerRef.current.clientWidth - 16;
             const scale = parentWidth / _viewport.width;
             const viewport = page.getViewport({ scale: Math.max(scale, 0.5) });
             
             canvas.width = viewport.width;
             canvas.height = viewport.height;
             
             renderTask = page.render({ canvasContext: ctx, viewport } as any);
             await renderTask.promise;
         } catch(e) {
             console.log("Render cancelled or failed");
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
                  onClick={() => setPageNumber(p => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1}
                  className="p-1 hover:bg-black hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black transition-colors"
               >
                   <ChevronLeft className="w-4 h-4" />
               </button>
               <span className="text-[10px] font-black uppercase tracking-widest">
                   Trang {pageNumber} / {parsedPdf.numPages}
               </span>
               <button 
                  onClick={() => setPageNumber(p => Math.min(parsedPdf.numPages, p + 1))}
                  disabled={pageNumber >= parsedPdf.numPages}
                  className="p-1 hover:bg-black hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black transition-colors"
               >
                   <ChevronRight className="w-4 h-4" />
               </button>
           </div>
           <div ref={containerRef} className="w-full flex justify-center bg-gray-50 border-2 border-black overflow-auto" style={{ maxHeight: '400px' }}>
                <canvas ref={canvasRef} className="max-w-full" />
           </div>
       </div>
   );
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [parsedPdf, setParsedPdf] = useState<ParsedPDF | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [style, setStyle] = useState<TranslationStyle>('genz');

  const [isTranslating, setIsTranslating] = useState(false);
  const [currentResult, setCurrentResult] = useState<{ segments: Segment[], error?: string }>({ segments: [] });
  
  const [history, setHistory] = useState<TranslationRecord[]>(() => {
    try {
       const h = sessionStorage.getItem('translationHistory');
       return h ? JSON.parse(h) : [];
    } catch { return []; }
  });

  const [activeTab, setActiveTab] = useState<'translate' | 'history'>('translate');
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  // TTS State
  const [voice, setVoice] = useState<VoiceName>('Kore');
  const [speed, setSpeed] = useState<number>(1.2);
  const [activeAudioSegment, setActiveAudioSegment] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGeneratingTTS, setIsGeneratingTTS] = useState(false);
  const [isGeneratingCombinedTTS, setIsGeneratingCombinedTTS] = useState(false);
  const [combinedTTSProgress, setCombinedTTSProgress] = useState('');
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    sessionStorage.setItem('translationHistory', JSON.stringify(history));
  }, [history]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') {
      setParseError('Vui lòng chọn file PDF.');
      return;
    }
    if (f.size > 20 * 1024 * 1024) { // 20MB limit
      setParseError('File quá lớn (> 20MB).');
      return;
    }

    setFile(f);
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(URL.createObjectURL(f));

    setIsParsing(true);
    setParseError('');
    setParsedPdf(null);
    setCurrentResult({ segments: [] });

    try {
      const pdf = await parsePDF(f);
      setParsedPdf(pdf);
      setStartPage(1);
      setEndPage(Math.min(pdf.numPages, 3)); // Default to first 3 pages
    } catch (err: any) {
      setParseError(err.message || 'Lỗi đọc file PDF.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleTranslate = async () => {
    if (!parsedPdf) return;
    if (startPage < 1 || startPage > parsedPdf.numPages || endPage < startPage || endPage > parsedPdf.numPages) {
      alert("Khoảng trang không hợp lệ.");
      return;
    }

    setIsTranslating(true);
    setCurrentResult({ segments: [] });
    // Stop any playing audio
    stopAudio();

    const newSegments: Segment[] = [];
    
    for (let i = startPage; i <= endPage; i++) {
        const text = parsedPdf.textByPage[i - 1];
        if (!text || !text.trim()) {
           newSegments.push({ pageNumber: i, original: "", translated: "" });
           setCurrentResult({ segments: [...newSegments] });
           continue;
        }

        // Add a placeholder structure so UI can render a loading state for this page
        newSegments.push({ pageNumber: i, original: text, translated: null });
        setCurrentResult({ segments: [...newSegments] });

        try {
            const translated = await translateText(text, style);
            // Replace placeholder with actual translation
            newSegments[newSegments.length - 1].translated = translated;
            setCurrentResult({ segments: [...newSegments] });
            
            // Wait 2.5s between pages to avoid Gemini rate limit on free tier
            if (i < endPage) {
                await new Promise(resolve => setTimeout(resolve, 2500));
            }
        } catch (err: any) {
            setCurrentResult({ segments: [...newSegments], error: `Lỗi khi dịch trang ${i}: ${err.message}` });
            break;
        }
    }

    setIsTranslating(false);

    if (newSegments.length > 0) {
       setHistory(prev => [{
           id: Date.now().toString(),
           date: Date.now(),
           fileName: file?.name || 'Document.pdf',
           style,
           segments: newSegments
       }, ...prev]);
    }
  };

  const playCombinedTTS = async () => {
      if (currentResult.segments.length === 0) return;
      
      stopAudio();
      setIsGeneratingCombinedTTS(true);
      setCombinedTTSProgress(`Đang xử lý trang 1/${currentResult.segments.length}...`);
      
      try {
          const pcmBuffers: Array<Uint8Array> = [];
          let index = 1;
          for (const segment of currentResult.segments) {
              setCombinedTTSProgress(`Đang xử lý trang ${index++}/${currentResult.segments.length}...`);
              if (segment.translated && segment.translated.trim()) {
                  // Wait 1s to prevent rate limits or overload
                  await new Promise(r => setTimeout(r, 1000));
                  const pcm = await generateRawTTS(segment.translated, voice);
                  pcmBuffers.push(pcm);
              }
          }
          
          if (pcmBuffers.length === 0) {
              throw new Error("Không có nội dung để đọc.");
          }
          
          const totalLength = pcmBuffers.reduce((acc, val) => acc + val.length, 0);
          const combinedPcm = new Uint8Array(totalLength);
          let offset = 0;
          for (const pcm of pcmBuffers) {
              combinedPcm.set(pcm, offset);
              offset += pcm.length;
          }
          
          const url = createWavBlobUrlFromPCM(combinedPcm);
          setAudioUrl(url);
          setActiveAudioSegment(-1);
          setIsPlaying(true);
      } catch (err: any) {
          alert("Lỗi tạo audio thu âm: " + err.message);
      } finally {
          setIsGeneratingCombinedTTS(false);
          setCombinedTTSProgress('');
      }
  };

  const playTTS = async (text: string, pageNumber: number) => {
      // Chunk text if too large? Usually a page handles reasonable size ~1000-2000 chars.
      // If we need to send the whole page, let's just try.
      if (!text.trim()) return;
      
      stopAudio();
      setActiveAudioSegment(pageNumber);
      setIsGeneratingTTS(true);
      
      try {
          const url = await generateTTS(text, voice);
          setAudioUrl(url);
          setIsGeneratingTTS(false);
          setIsPlaying(true);
      } catch (err: any) {
          alert("Lỗi tải giọng đọc: " + err.message);
          setIsGeneratingTTS(false);
          setActiveAudioSegment(null);
      }
  };

  const stopAudio = () => {
      if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
      }
      setIsPlaying(false);
      setAudioUrl(null);
      setActiveAudioSegment(null);
      setAudioProgress(0);
      setAudioDuration(0);
  };
  
  const togglePlayAudio = () => {
      if (!audioRef.current) return;
      if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
      } else {
          audioRef.current.play();
          setIsPlaying(true);
      }
  };

  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const downloadPDF = async () => {
     if (!pdfContainerRef.current) return;
     setIsExportingPDF(true);
     
     const opt = {
        margin:       0.5,
        filename:     `${file?.name ? file.name.replace('.pdf', '') : 'Document'}_Translated_${style}.pdf`,
        image:        { type: 'jpeg' as const, quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const }
     };

     try {
        await html2pdf().from(pdfContainerRef.current).set(opt).save();
     } catch (err) {
        console.error("PDF generation failed", err);
        alert("Lỗi khi tạo PDF.");
     } finally {
        setIsExportingPDF(false);
     }
  };

  return (
    <div className="h-screen bg-[#FAF9F6] text-black font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center p-6 pb-2 shrink-0">
        <div className="flex flex-col">
           <h1 className="text-5xl font-black tracking-tighter leading-none">READ<span className="text-[#6366F1]">ZO</span></h1>
           <p className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">AI-Powered PDF Translation & TTS</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex bg-white p-1 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <button 
               onClick={() => setActiveTab('translate')}
               className={`px-4 py-2 text-sm font-black uppercase transition-colors ${activeTab === 'translate' ? 'bg-black text-white' : 'hover:bg-gray-100'}`}>
               Dịch
            </button>
            <button 
               onClick={() => setActiveTab('history')}
               className={`px-4 py-2 text-sm font-black uppercase transition-colors ${activeTab === 'history' ? 'bg-black text-white' : 'hover:bg-gray-100'}`}>
               Lịch sử
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 gap-6 min-h-0 p-6 pt-4">
        {activeTab === 'translate' ? (
          <>
            
            {/* Left Sidebar - Controls */}
            <aside className="w-80 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2 pb-2">
              
              {/* Upload Card */}
              {!file ? (
                 <div className="bg-white border-2 border-black p-4 flex flex-col gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0">
                    <h2 className="text-lg font-black uppercase border-b-2 border-black pb-2">Upload PDF</h2>
                    <label className="relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-black hover:bg-gray-100 cursor-pointer">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="w-8 h-8 text-black mb-2" />
                            <p className="mb-2 text-sm text-black font-bold uppercase">Tải lên file PDF</p>
                            <p className="text-[10px] font-black opacity-50 uppercase">Tối đa 20MB</p>
                      </div>
                      <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
                    </label>
                    
                    {isParsing && <div className="mt-2 flex items-center gap-2 text-black text-sm font-bold uppercase"><Loader2 className="w-4 h-4 animate-spin"/> Đang đọc PDF...</div>}
                    {parseError && <div className="mt-2 text-white text-sm font-bold px-3 py-2 bg-red-500 border-2 border-black">{parseError}</div>}
                 </div>
              ) : (
                 <div className="flex justify-between items-center bg-white border-2 border-black p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0">
                    <span className="text-xs font-bold truncate max-w-[180px]">{file.name}</span>
                    <label className="cursor-pointer bg-black text-white px-3 py-1.5 text-[10px] uppercase font-black hover:-translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all">
                       Đổi file
                       <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
                    </label>
                 </div>
              )}

              {/* Mini PDF Preview */}
              {parsedPdf && !isParsing && !parseError && (
                 <PDFPagePreview parsedPdf={parsedPdf} currentPage={startPage} />
              )}

              {/* Translation Settings View */}
              {parsedPdf && !isParsing && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white border-2 border-black p-4 flex flex-col gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0">
                  <h2 className="text-lg font-black uppercase border-b-2 border-black pb-2">Cấu hình Dịch</h2>
                  
                  {/* Page Range Selectors */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase opacity-50">Phạm vi trang (1 - {parsedPdf.numPages})</label>
                    <div className="flex items-center gap-2">
                       <input type="number" min={1} max={parsedPdf.numPages} value={startPage} onChange={e => setStartPage(Number(e.target.value))}
                         className="w-full border-2 border-black p-2 text-sm font-bold bg-white text-center" />
                       <span className="font-black">-</span>
                       <input type="number" min={startPage} max={parsedPdf.numPages} value={endPage} onChange={e => setEndPage(Number(e.target.value))}
                         className="w-full border-2 border-black p-2 text-sm font-bold bg-white text-center" />
                    </div>

                    {parsedPdf.outline.length > 0 && (
                      <div className="mt-3">
                        <label className="text-[10px] font-black uppercase opacity-50">Chương lục</label>
                        <select 
                           className="w-full border-2 border-black p-2 text-sm font-bold bg-white"
                           onChange={(e) => {
                             const p = Number(e.target.value);
                             if (p) { setStartPage(p); setEndPage(p); }
                           }}
                        >
                           <option value="">-- Chọn nhanh chương --</option>
                           {parsedPdf.outline.map((item, idx) => (
                             <option key={idx} value={item.pageNumber}>{item.title} (Trg {item.pageNumber})</option>
                           ))}
                        </select>
                      </div>
                    )}
                  </div>
                  
                  {/* Style Settings */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase opacity-50">Phong cách dịch</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setStyle('chuẩn')}
                        className={`py-2 text-sm font-bold uppercase border-2 ${style === 'chuẩn' ? 'bg-black text-white border-black' : 'bg-gray-100 border-black hover:bg-gray-200'}`}>
                        Chuẩn
                      </button>
                      <button 
                        onClick={() => setStyle('genz')}
                        className={`py-2 text-sm font-bold uppercase border-2 ${style === 'genz' ? 'bg-black text-white border-black' : 'bg-gray-100 border-black hover:bg-gray-200'}`}>
                        Gen Z
                      </button>
                    </div>
                  </div>

                  <button 
                    onClick={handleTranslate}
                    disabled={isTranslating || !parsedPdf}
                    className="w-full bg-[#FACC15] border-2 border-black px-6 py-3 text-lg font-black uppercase 
                               hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] 
                               active:translate-y-0 active:translate-x-0 active:shadow-none transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none flex justify-center items-center gap-2 mt-2">
                    {isTranslating ? <><Loader2 className="w-5 h-5 animate-spin"/> Đang dịch</> : 'DỊCH NGAY'}
                  </button>
                </motion.div>
              )}

              {/* TTS Global Settings */}
              <div className="bg-white border-2 border-black p-4 flex flex-col gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0">
                  <h2 className="text-lg font-black uppercase border-b-2 border-black pb-2">Text-to-Speech</h2>
                  
                  <div className="space-y-1">
                     <label className="text-[10px] font-black uppercase opacity-50">Giọng đọc</label>
                     <select value={voice} onChange={e => setVoice(e.target.value as VoiceName)}
                        className="w-full border-2 border-black p-2 text-sm font-bold bg-white">
                        <option value="Kore">Miền Nam (Dễ thương)</option>
                        <option value="Puck">Miền Nam (Trẻ trung)</option>
                        <option value="Charon">Miền Bắc (Nam mạnh)</option>
                        <option value="Fenrir">Miền Bắc (Nữ chuẩn)</option>
                        <option value="Zephyr">Trung lập</option>
                     </select>
                  </div>
                  
                  <div className="space-y-1">
                     <label className="text-[10px] font-black uppercase opacity-50">Tốc độ ({speed.toFixed(1)}x)</label>
                     <div className="flex justify-between bg-gray-100 p-1 border-2 border-black">
                        {[0.8, 1.0, 1.2, 1.5].map(s => (
                           <button 
                              key={s}
                              onClick={() => setSpeed(s)}
                              className={`px-2 py-1 text-xs font-black border-2 ${speed === s ? 'bg-white border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]' : 'border-transparent hover:border-black/20'}`}
                           >
                              {s.toFixed(1)}x
                           </button>
                        ))}
                     </div>
                  </div>
              </div>

            </aside>

            {/* Right Main Content - Results */}
            <div className="flex-1 flex flex-col min-h-0">
               {/* Hidden Audio element */}
               {audioUrl && (
                  <audio 
                     ref={audioRef} 
                     src={audioUrl} 
                     onEnded={() => setIsPlaying(false)}
                     onPlay={() => { if(audioRef.current) audioRef.current.playbackRate = speed; setIsPlaying(true) }}
                     onPause={() => setIsPlaying(false)}
                     onRateChange={() => { if(audioRef.current && audioRef.current.playbackRate !== speed) audioRef.current.playbackRate = speed; }}
                     onTimeUpdate={(e) => setAudioProgress(e.currentTarget.currentTime)}
                     onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
                  />
               )}

               {currentResult.segments.length > 0 && !isTranslating && !currentResult.error && (
                   <div className="flex justify-end gap-2 mb-4 shrink-0">
                       <button 
                           onClick={playCombinedTTS}
                           disabled={isGeneratingCombinedTTS || isGeneratingTTS}
                           className="bg-[#22C55E] text-white px-4 py-2 border-2 border-black font-black uppercase text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all flex items-center gap-2 disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                       >
                           {isGeneratingCombinedTTS ? <Loader2 className="w-4 h-4 animate-spin"/> : <Volume2 className="w-4 h-4" />}
                           {isGeneratingCombinedTTS ? combinedTTSProgress : 'Tạo Audio Tất Cả Trang'}
                       </button>
                       <button 
                           onClick={downloadPDF}
                           disabled={isExportingPDF}
                           className="bg-[#A21CAF] text-white px-4 py-2 border-2 border-black font-black uppercase text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all flex items-center gap-2 disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                       >
                           {isExportingPDF ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4" />}
                           {isExportingPDF ? 'Đang tạo PDF...' : 'Tải bản dịch (PDF)'}
                       </button>
                   </div>
               )}
               
               <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                   {currentResult.segments.length === 0 ? (
                       <div className="h-full flex flex-col items-center justify-center border-2 border-black border-dashed bg-gray-50 opacity-50 p-12">
                           <FileText className="w-12 h-12 mb-4" />
                           <p className="font-bold uppercase tracking-widest text-sm">Kết quả biên dịch sẽ hiển thị tại đây.</p>
                       </div>
                   ) : (
                       <div className="bg-[#E0F2FE] border-2 border-black flex flex-col shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all">
                          <div className="border-b-2 border-black px-4 py-3 bg-[#BAE6FD] flex justify-between items-center sticky top-0 z-10 shadow-sm">
                             <span className="text-xs font-black uppercase tracking-widest text-[#0369A1]">Bản dịch liên tục ({style})</span>
                          </div>
                          
                          <div className="p-8 overflow-auto h-full min-h-[400px] custom-scrollbar selection:bg-pink-300">
                             {currentResult.segments.map((segment, idx) => (
                                <motion.div initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }} key={segment.pageNumber} className={idx > 0 ? "mt-8" : ""}>
                                   
                                   {/* Lightweight Page Divider & TTS Controls */}
                                   <div className="flex items-center mb-6 mt-4 opacity-80 hover:opacity-100 transition-opacity">
                                       <div className="h-px bg-blue-300 flex-1"></div>
                                       <span className="mx-4 text-[10px] font-black uppercase text-blue-600 tracking-widest text-center">
                                           · Trang {segment.pageNumber} ·
                                       </span>
                                       <div className="h-px bg-blue-300 w-8 mr-2"></div>
                                       
                                       <div className="flex items-center">
                                          {activeAudioSegment === segment.pageNumber && audioUrl ? (
                                              <div className="flex items-center gap-1 bg-[#FACC15] text-black px-2 py-1 border border-black font-black uppercase text-[10px] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] scale-90 origin-right">
                                                  <button onClick={togglePlayAudio} className="hover:scale-110 transition-transform">
                                                    {isPlaying ? <Pause className="w-3 h-3"/> : <Play className="w-3 h-3 fill-current"/>}
                                                  </button>
                                                  <button onClick={stopAudio} className="hover:scale-110 transition-transform">
                                                    <Square className="w-2.5 h-2.5 fill-current"/>
                                                  </button>
                                              </div>
                                           ) : activeAudioSegment === segment.pageNumber && isGeneratingTTS ? (
                                              <div className="flex items-center gap-1 bg-gray-100 text-black px-2 py-1 border border-black font-black uppercase text-[10px] scale-90 origin-right">
                                                   <Loader2 className="w-3 h-3 animate-spin"/> ...
                                              </div>
                                           ) : (
                                               <button 
                                                   onClick={() => playTTS(segment.translated!, segment.pageNumber)}
                                                   className="flex items-center gap-1 bg-black hover:bg-gray-800 text-white px-2 py-1 text-[10px] font-black uppercase border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all scale-90 origin-right"
                                                   disabled={!segment.translated || isGeneratingTTS}
                                               >
                                                   <Volume2 className="w-3 h-3"/> Nghe
                                               </button>
                                           )}
                                       </div>
                                   </div>

                                   {/* Translated Content */}
                                   <div className="markdown-body">
                                      {segment.translated !== null && segment.translated !== "" ? (
                                         <Markdown>{segment.translated}</Markdown>
                                      ) : segment.translated === "" ? (
                                         <span className="text-[10px] font-black uppercase opacity-50 block text-center py-4">
                                            Nội dung trang trống
                                         </span>
                                      ) : isTranslating ? (
                                         <div className="flex justify-center py-8">
                                             <div className="flex gap-2 mb-2">
                                               <div className="w-3 h-3 bg-pink-500 rounded-full animate-bounce"></div>
                                               <div className="w-3 h-3 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                                               <div className="w-3 h-3 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                                             </div>
                                         </div>
                                      ) : (
                                         <span className="text-[10px] font-black uppercase opacity-50 block text-center py-4 text-red-500">
                                            Lỗi / Bị gián đoạn
                                         </span>
                                      )}
                                   </div>
                                </motion.div>
                             ))}
                             
                             {currentResult.error && (
                                 <div className="mt-8 mb-4 mx-8 p-4 bg-red-50 text-red-600 border-2 border-red-200 text-sm font-bold text-center">
                                    {currentResult.error}
                                 </div>
                             )}
                          </div>
                       </div>
                   )}
               </div>
               
               {activeAudioSegment !== null && (
                  <div className="mt-4 bg-black text-white p-4 flex flex-col sm:flex-row sm:items-center gap-6 shadow-[8px_8px_0px_0px_rgba(242,125,38,1)] border-2 border-white">
                     <div className="flex items-center gap-4 shrink-0">
                        <button onClick={togglePlayAudio} className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-transform">
                          {isPlaying ? <Pause className="w-5 h-5 fill-current"/> : <Play className="w-5 h-5 fill-current ml-1"/>}
                        </button>
                        <div className="flex flex-col">
                           <span className="text-[10px] font-black uppercase text-gray-400">Đang phát bản dịch</span>
                           <span className="text-sm font-bold truncate w-32 sm:w-48 text-white">{activeAudioSegment === -1 ? 'Toàn bộ bản dịch' : `Trang ${activeAudioSegment}`}</span>
                        </div>
                     </div>
                     <div className="flex-1 flex flex-col gap-2 relative group">
                        <div className="flex justify-between text-[10px] font-black">
                           <span>{formatTime(audioProgress)}</span>
                           <span>{formatTime(audioDuration)}</span>
                        </div>
                        <div 
                            className="w-full h-3 bg-gray-800 cursor-pointer overflow-hidden relative"
                            onClick={(e) => {
                                if (audioRef.current && audioDuration) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                                    audioRef.current.currentTime = (x / rect.width) * audioDuration;
                                }
                            }}
                        >
                           <div className="absolute top-0 left-0 h-full bg-[#FACC15] pointer-events-none" style={{ width: `${audioDuration ? (audioProgress / audioDuration) * 100 : 0}%` }}></div>
                        </div>
                     </div>
                     <button onClick={stopAudio} className="border-2 border-white px-4 py-2 text-xs font-black uppercase hover:bg-white hover:text-black transition-colors shrink-0">Đóng</button>
                  </div>
               )}
            </div>

          </>
        ) : (
          /* History View */
          <div className="w-full max-w-4xl mx-auto bg-white border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden flex flex-col relative h-full">
             <div className="px-6 py-4 border-b-2 border-black bg-gray-50 flex items-center gap-3">
                 <History className="w-5 h-5 text-black" />
                 <h2 className="text-lg font-black uppercase">Lịch sử biên dịch</h2>
             </div>
             <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                 {history.length === 0 ? (
                     <div className="text-center py-12 text-sm font-black uppercase opacity-40">Chưa có bản dịch nào được lưu.</div>
                 ) : (
                     <div className="space-y-6">
                         {history.map((record) => (
                             <div key={record.id} className="border-2 border-black overflow-hidden hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all bg-white group">
                                 <div className="bg-gray-100 px-4 py-3 flex items-center justify-between border-b-2 border-black">
                                     <div>
                                        <div className="font-bold text-black flex items-center gap-2">
                                            {record.fileName} 
                                            <span className={`text-[10px] uppercase font-black px-2 py-0.5 border-2 border-black ${record.style === 'genz' ? 'bg-[#FDF4FF] text-[#A21CAF]' : 'bg-[#E0F2FE] text-blue-600'}`}>
                                                {record.style === 'genz' ? 'Gen Z' : 'Chuẩn'}
                                            </span>
                                        </div>
                                        <div className="text-[10px] font-black uppercase opacity-60 mt-1">
                                           {new Date(record.date).toLocaleString()} • {record.segments.length} trang
                                        </div>
                                     </div>
                                 </div>
                                 <div className="p-4 max-h-64 overflow-y-auto space-y-4 custom-scrollbar">
                                    {record.segments.map(seg => (
                                        <div key={seg.pageNumber}>
                                            <div className="text-[10px] font-black uppercase opacity-40 mb-1">Trang {seg.pageNumber}</div>
                                            <div className="markdown-body opacity-90 scale-90 origin-top-left">
                                                <Markdown>{seg.translated?.slice(0, 500) + (seg.translated?.length > 500 ? '...' : '')}</Markdown>
                                            </div>
                                        </div>
                                    ))}
                                 </div>
                             </div>
                         ))}
                     </div>
                 )}
             </div>
          </div>
        )}
      </div>

      {/* Hidden Container for PDF Export */}
      <div className="absolute left-[-9999px] top-0 w-[1000px] z-[-1] overflow-hidden">
        <div ref={pdfContainerRef} className="bg-white p-8 text-black font-sans leading-relaxed">
           <h1 className="text-3xl font-black uppercase mb-4 border-b-4 border-black pb-4">
              {file?.name || 'Tài liệu PDF'}
           </h1>
           <div className="flex justify-between text-sm font-black uppercase border-b-2 border-black pb-2 mb-6">
               <span className="w-1/2 pr-4 border-r-2 border-black">Bản gốc (Tiếng Anh)</span>
               <span className="w-1/2 pl-4">Bản dịch ({style === 'chuẩn' ? 'Chuẩn' : 'Gen Z'})</span>
           </div>
           
           <div className="flex flex-col gap-6">
              {currentResult.segments.map(seg => (
                 <div key={seg.pageNumber} className="flex flex-row border-b-2 border-dashed border-gray-300 pb-6 gap-8 html2pdf__page-break">
                     {/* html2pdf__page-break class may not work directly without config, but we can try */}
                     <div className="w-1/2 font-serif text-sm whitespace-pre-wrap break-words">
                         {seg.original}
                     </div>
                     <div className="w-1/2 font-sans font-medium text-[15px] break-words markdown-body">
                         <Markdown>{seg.translated || ''}</Markdown>
                     </div>
                 </div>
              ))}
           </div>
           <div className="mt-8 pt-4 border-t-2 border-black text-center text-xs font-black uppercase opacity-50">
               Tạo bởi READZO
           </div>
        </div>
      </div>

    </div>
  );
}
