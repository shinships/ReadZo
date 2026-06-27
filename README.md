# READZO

Dịch file PDF tiếng Anh sang tiếng Việt (phong cách **Chuẩn** hoặc **Gen Z**) và nghe bản dịch bằng giọng đọc AI (TTS) đa giọng. Chạy trên Google Gemini qua **Vertex AI**.

## Kiến trúc

```
Trình duyệt (Vite, cổng 3000)              Server (Express, cổng 4000)
─────────────────────────────              ───────────────────────────
src/App.tsx        UI + state              server.ts
src/lib/pdf.ts     đọc PDF (pdfjs)   ──►   POST /api/translate  ─┐
src/lib/ai.ts      fetch /api ───────►     POST /api/tts        ─┴─► Gemini (Vertex AI)
                                           (giữ credentials, không lộ ra client)
```

API key / credentials **chỉ nằm ở server**, không bao giờ được nhúng vào bundle phía trình duyệt. Trong dev, Vite proxy `/api` sang server cổng 4000. Trong production, Express phục vụ luôn thư mục `dist/`.

**Model dùng:** `gemini-3.1-pro-preview` (dịch) và `gemini-3.1-flash-tts-preview` (TTS). Đây là model preview nên trên Vertex chỉ chạy ở `location=global`.

## Yêu cầu

- Node.js 20+
- Một trong hai cách xác thực:
  - **Vertex AI** (khuyến nghị — bill vào Google Cloud / trial credit), hoặc
  - **Gemini Developer API** (AI Studio) bằng API key.

## Cài đặt

```bash
npm install
```

## Cấu hình

Tạo file `.env.local` (đã được gitignore). Chọn **một** trong hai cách:

### Cách A — Vertex AI (khuyến nghị)

```ini
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=<project-id-của-bạn>
GOOGLE_CLOUD_LOCATION=global
```

Rồi đăng nhập Application Default Credentials:

```bash
gcloud auth application-default login
```

Project cần bật API `aiplatform.googleapis.com` và tài khoản có role `roles/aiplatform.user`.

> Lưu ý: nếu máy có biến hệ thống `GOOGLE_APPLICATION_CREDENTIALS` trỏ tới một service account khác, server sẽ tự bỏ qua nó khi ở chế độ Vertex để dùng đúng gcloud ADC (trừ khi bạn tự khai `GOOGLE_APPLICATION_CREDENTIALS` trong `.env.local`).

### Cách B — Gemini Developer API (AI Studio)

Để trống các biến `GOOGLE_CLOUD_*` ở trên và đặt:

```ini
GEMINI_API_KEY=<api-key-của-bạn>
```

## Chạy

```bash
npm run dev
```

- Frontend: http://localhost:3000
- API server: http://localhost:4000 (Vite tự proxy `/api` sang đây)

## Production

```bash
npm run start    # build frontend rồi chạy Express phục vụ dist/ + /api
```

Trên Cloud Run, biến `PORT` được nền tảng tự inject; server bind `0.0.0.0`.

## Scripts

| Lệnh | Mô tả |
|------|-------|
| `npm run dev` | Chạy đồng thời server + client (qua `concurrently`) |
| `npm run dev:client` | Chỉ Vite (cổng 3000) |
| `npm run dev:server` | Chỉ Express (cổng 4000, `tsx watch`) |
| `npm run build` | Build frontend ra `dist/` |
| `npm run serve` | Chạy Express phục vụ `dist/` + `/api` |
| `npm run start` | `build` + `serve` |
| `npm run lint` | Type-check (`tsc --noEmit`) |

## Lưu ý kỹ thuật

- **Cổng 4000**: trên Windows, dải `3001–3500` (và `2721–2920`) thường bị Hyper-V/WSL giữ trước → không dùng. Đổi cổng qua biến `PORT` nếu cần.
- **Giới hạn file**: PDF tối đa 20MB.
- **Bộ nhớ**: bản dịch, lịch sử, cache, và cấu hình được lưu trong `sessionStorage` (mất khi đóng tab).
