import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// GitHub Pages はリポジトリ名のサブパス（/baaba-ai/）で配信されるため、
// 本番ビルド時のみ base を合わせる。ローカル開発・preview は従来どおりルート配信。
// 環境変数 VITE_BASE_PATH で上書きできる（Vercel等ルート配信のホスティングでは '/' を指定する）。
const basePath = process.env.VITE_BASE_PATH ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base: basePath,
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
