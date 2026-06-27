import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  // The Gemini API key is never exposed to the client. All AI calls go through
  // the Express API server (server.ts), proxied below during development.
  const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Split heavy libs into separate chunks so the initial load is smaller.
          manualChunks: {
            pdfjs: ['pdfjs-dist'],
            markdown: ['react-markdown'],
            motion: ['motion'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
