import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mkcert()],
  server: {
    // vite-plugin-mkcert が Vite 5+ ではhttps有効化を自動で行うため、`https: true` は不要
    // （型定義上も ServerOptions と衝突してtscエラーになるため指定しない）。
    host: true,
    proxy: {
      // 音声認識プロキシサーバー（server/index.js）へ転送する。
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
