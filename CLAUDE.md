# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

READZO is a client-side React app that translates PDF files into Vietnamese — with a choice of **standard** (`chuẩn`) or **Gen Z** (`genz`) tone — and reads the translation aloud via text-to-speech with multiple regional Vietnamese voices. It was scaffolded as a Google AI Studio app (`react-example` in `package.json`) and uses the Gemini API for both translation and TTS.

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
- **`src/lib/ai.ts`** — all Gemini calls. `translateText(text, style)` swaps the *system instruction* based on style (the Gen Z prompt enforces strict slang/emoji/Markdown rules — translations are expected to come back as Markdown). TTS returns raw 16-bit PCM mono; `createWavBlobUrlFromPCM` wraps it in a hand-built 44-byte WAV header (24000 Hz) to make a playable blob URL. Models used: `gemini-3.1-pro-preview` (translate) and `gemini-3.1-flash-tts-preview` (TTS).
- **`src/App.tsx`** — the entire UI and all state (single component, ~800 lines). No router, no global store.

### Key flows and conventions in App.tsx

- **Translation is sequential, page-by-page.** `handleTranslate` loops `startPage`→`endPage`, pushing a placeholder segment (`translated: null`) so the UI shows a per-page loading state, then fills it in. It sleeps **2.5s between uncached pages** to stay under Gemini free-tier rate limits. Combined TTS (`playCombinedTTS`) similarly sleeps **1s per page** and concatenates PCM buffers before building one WAV.
- **Persistence is `sessionStorage`, not localStorage** — three keys: `translationState` (current settings + results + filename), `translationHistory`, and `translationCache`. Each has its own `useEffect` that writes on change. Because PDFs themselves aren't persisted, a restored session shows results but prompts the user to re-upload the file to translate more pages.
- **Translation cache key** is `` `${style}_${text.length}_${text.substring(0,100)}` `` — a heuristic, not a hash. Cached pages skip the rate-limit sleep.
- **Markdown rendering**: translated text is rendered with `react-markdown` inside `.markdown-body`, which is styled in `src/index.css` (yellow-highlight `strong`, `→` bullets, neobrutalist blockquotes). The translation prompts and this CSS are coupled — changing one may require changing the other.
- **PDF export** (`downloadPDF`) renders an off-screen two-column (original | translated) container via `html2pdf.js`. `html2pdf.js` has no real types — see `src/html2pdf.d.ts` (declared as `any`).

### Styling

Tailwind CSS v4 via the `@tailwindcss/vite` plugin (imported in `src/index.css` with `@import "tailwindcss"`, no `tailwind.config.js`). The design is **neobrutalist**: 2px black borders, hard offset box-shadows (`shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`), `font-black uppercase`, translate-on-hover. Match this style for any new UI. Animations use `motion/react`; icons use `lucide-react`.

## Conventions

- TypeScript is strict-ish but `noEmit` (Vite handles transpilation); `allowImportingTsExtensions` is on, so local imports use explicit extensions (e.g. `./App.tsx`).
- Path alias `@/*` maps to the repo root (`tsconfig.json` + `vite.config.ts`), though most imports are relative.
- Error/status messages shown to users are Vietnamese strings inline in the JSX.
</content>
</invoke>
