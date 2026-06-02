# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

READZO is a client-side React app that translates documents (**PDF**, **DOCX**, **TXT**) into Vietnamese — with a choice of **standard** (`chuẩn`) or **Gen Z** (`genz`) tone — and reads them aloud via text-to-speech with multiple regional Vietnamese voices. It can also read the source text directly without translating (direct-read mode). It was scaffolded as a Google AI Studio app (`react-example` in `package.json`) and uses the Gemini API for both translation and TTS.

The UI language is Vietnamese. Keep user-facing strings in Vietnamese to match the existing app.

## Commands

```bash
npm install        # install dependencies
npm run dev        # dev server on http://0.0.0.0:3000
npm run build      # production build via Vite
npm run preview    # preview the production build
npm run lint       # type-check only: tsc --noEmit (no ESLint configured)
npm run clean      # remove dist/
```

There is no test runner configured — `npm run lint` (TypeScript type-checking) is the only verification gate. Run it before considering a change complete.

## Environment

Set `GEMINI_API_KEY` in `.env.local` (gitignored). Vite injects it at build time via `define` in `vite.config.ts` as `process.env.GEMINI_API_KEY`, which `src/lib/ai.ts` reads through `getAI()`. The key is therefore exposed in the client bundle — this is by design for the AI Studio sandbox, not a production-secure pattern. `APP_URL` is also recognized (see `.env.example`) but currently unused in code.

`vite.config.ts` gates HMR behind `DISABLE_HMR` (AI Studio sets this to prevent flicker during agent edits) — do not change the HMR/file-watching config.

## Architecture

Everything runs in the browser; there is no backend despite `express` being a listed dependency. The app is three files of substance:

- **`src/lib/pdf.ts`** — `parsePDF(file)` uses `pdfjs-dist` (with a locally-bundled worker, see the `?url` import) to produce a `ParsedPDF`: `numPages`, `textByPage[]` (text extracted in batches of 10 pages), an `outline[]` (table of contents → page numbers), and the live `pdfDoc` proxy (kept so the UI can render page canvases).
- **`src/lib/document.ts`** — format-agnostic layer over `pdf.ts`. `parseDocument(file)` dispatches on `detectFormat` (PDF / DOCX / TXT) and returns a unified `ParsedDocument` (`format`, `numPages`, `textByPage[]`, `outline[]`, optional `pdf` for the canvas preview). DOCX is parsed client-side via a **dynamic** `import('mammoth')` (`extractRawText`) so PDF/TXT users don't pay the bundle cost; DOCX/TXT have no real pages, so `splitIntoPseudoPages` chunks their text into ~3000-char pseudo-pages that map 1:1 onto the page-indexed `Segment` model. The app keeps everything in terms of `ParsedDocument`; only `PDFPagePreview` still takes a raw `ParsedPDF`.
- **`src/lib/ai.ts`** — all Gemini calls. `translateText(text, style)` swaps the *system instruction* based on style (the Gen Z prompt enforces strict slang/emoji/Markdown rules — translations are expected to come back as Markdown). TTS returns raw 16-bit PCM mono; `createWavBlobUrlFromPCM` wraps it in a hand-built 44-byte WAV header (24000 Hz) to make a playable blob URL. Long text is split by `chunkText` (sentence/paragraph boundaries, ~1800 chars) and read via `generateRawTTSChunked`, which concatenates per-chunk PCM with `concatPcm`; this is what both single-page and combined TTS call. Models used: `gemini-3.1-pro-preview` (translate) and `gemini-3.1-flash-tts-preview` (TTS).
- **`src/App.tsx`** — the entire UI and all state (single component, ~800 lines). No router, no global store.

### Key flows and conventions in App.tsx

- **Two read modes** (`readMode` state): **`translate`** runs `handleTranslate` (LLM dịch rồi đọc), **`direct`** runs `buildDirectSegments` which reads the source text aloud without translating. Direct mode's trick is setting `translated = original` on each segment, so the entire results panel, per-page TTS, combined TTS, and PDF export work unchanged — they all key off `segment.translated`. The mode is recorded on each `TranslationRecord` (`mode`) for the history badge.
- **Translation is sequential, page-by-page.** `handleTranslate` loops `startPage`→`endPage`, pushing a placeholder segment (`translated: null`) so the UI shows a per-page loading state, then fills it in. It sleeps **2.5s between uncached pages** to stay under Gemini free-tier rate limits. Combined TTS (`playCombinedTTS`) similarly sleeps **1s per page** (plus 1s between chunks inside a page) and concatenates PCM buffers before building one WAV.
- **Persistence is `sessionStorage`, not localStorage** — three keys: `translationState` (current settings + results + filename), `translationHistory`, and `translationCache`. Each has its own `useEffect` that writes on change. Because PDFs themselves aren't persisted, a restored session shows results but prompts the user to re-upload the file to translate more pages.
- **Translation cache key** is `` `${style}_${text.length}_${text.substring(0,100)}` `` — a heuristic, not a hash. Cached pages skip the rate-limit sleep.
- **Markdown rendering**: translated text is rendered with `react-markdown` inside `.markdown-body`, which is styled in `src/index.css` (yellow-highlight `strong`, `→` bullets, neobrutalist blockquotes). The translation prompts and this CSS are coupled — changing one may require changing the other.
- **PDF export** (`downloadPDF`) renders an off-screen two-column (original | translated) container via `html2pdf.js`. `html2pdf.js` has no real types — see `src/html2pdf.d.ts` (declared as `any`).

### Styling

Tailwind CSS v4 via the `@tailwindcss/vite` plugin (imported in `src/index.css` with `@import "tailwindcss"`, no `tailwind.config.js`). The design is **neobrutalist**: 2px black borders, hard offset box-shadows (`shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`), `font-black uppercase`, translate-on-hover. Match this style for any new UI. Animations use `motion/react`; icons use `lucide-react`.

The layout is **mobile-first**: default is a single stacked column, `md:` restores the desktop two-pane shell. The root is `min-h-screen md:h-screen ... md:overflow-hidden` (mobile scrolls the page, desktop keeps fixed panes with inner scroll). The settings sidebar is a `motion` slide-in **drawer** on mobile (toggled by `settingsOpen`, a "Cấu hình" button in the header) and a static `w-80` column at `md:`. The audio player bar is `fixed bottom-0 md:static`.

## Conventions

- TypeScript is strict-ish but `noEmit` (Vite handles transpilation); `allowImportingTsExtensions` is on, so local imports use explicit extensions (e.g. `./App.tsx`).
- Path alias `@/*` maps to the repo root (`tsconfig.json` + `vite.config.ts`), though most imports are relative.
- Error/status messages shown to users are Vietnamese strings inline in the JSX.
</content>
</invoke>
