# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

READZO — a web app that translates English PDFs into Vietnamese (standard or "Gen Z" style) and reads the translation aloud via Gemini TTS. UI/comments are in Vietnamese; match that when editing user-facing strings.

## Architecture

Two processes, split by trust boundary:

- **Frontend** — Vite + React 19 + TypeScript + Tailwind v4, dev port **3000**.
  - `src/App.tsx` — all UI and state (single component file).
  - `src/lib/pdf.ts` — PDF parsing/rendering via `pdfjs-dist` (batched text extraction, outline).
  - `src/lib/ai.ts` — **client-side AI layer; calls `/api/*` only.** Contains no credentials and no `@google/genai` import. Also holds `createWavBlobUrlFromPCM` (pure PCM→WAV helper).
- **Backend** — Express in `server.ts`, dev port **4000**.
  - `POST /api/translate` `{ text, style }` → `{ translated }`
  - `POST /api/tts` `{ text, voiceName }` → `{ audio }` (base64 PCM, 16-bit LE mono 24kHz)
  - Holds all credentials; serves `dist/` in production.

In dev, Vite proxies `/api` → `http://127.0.0.1:4000` (see `vite.config.ts`). The Gemini key/credentials must **never** reach the client bundle — that was the original bug this layout fixes.

## Commands

- `npm run dev` — server + client together (concurrently).
- `npm run lint` — type-check (`tsc --noEmit`). Run this before declaring work done; there is no test suite.
- `npm run build` — frontend → `dist/`.
- `npm run start` — build + serve via Express (production / Cloud Run shape).

## Auth & models

- `getAI()` in `server.ts` picks the mode:
  - **Vertex AI** when `GOOGLE_GENAI_USE_VERTEXAI=true` or `GOOGLE_CLOUD_PROJECT` is set → `new GoogleGenAI({ vertexai:true, project, location })` with ADC. Bills to Google Cloud.
  - **AI Studio** otherwise → `new GoogleGenAI({ apiKey: GEMINI_API_KEY })`.
- Models: `gemini-3.1-pro-preview` (translate), `gemini-3.1-flash-tts-preview` (TTS). Both are **preview → require `location=global`** on Vertex (regional endpoints 404).
- TTS on Vertex requires `contents: [{ role: 'user', parts: [...] }]` — the `role` field is mandatory there (omitting it 400s).

## Gotchas (do not regress these)

- **Port 4000, not 3001.** Windows reserves TCP `3001–3500` (and `2721–2920`) via Hyper-V/WSL; binding there fails with `EACCES`. Pick ports outside those ranges.
- **`GOOGLE_APPLICATION_CREDENTIALS` override.** This machine may have a global `GOOGLE_APPLICATION_CREDENTIALS` pointing at an unrelated service account. In Vertex mode `server.ts` deletes the inherited var (unless set in `.env.local`) so it falls back to the developer's gcloud ADC. Keep this behavior.
- **`.env.local` is gitignored** and is the source of truth for local config; `.env.example` documents both auth paths.
- **No secrets in the client.** Anything touching the API key stays in `server.ts`.

## Conventions

- Neo-brutalist Tailwind styling (thick black borders, hard box-shadows like `shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`, uppercase `font-black`). Match it for new UI.
- The `style` discriminator is the literal `'chuẩn' | 'genz'` — keep both client and server using the exact same accented string.
- Persistence is `sessionStorage` (translation, history, cache, settings).
