import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createShareHandler } from './scripts/sharing/broker.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name:'device-share-signaling',
    configureServer(server) {
      const env=loadEnv(server.config.mode,server.config.root,'SHARE_')
      server.middlewares.use(createShareHandler({statePath:env.SHARE_STATE_PATH || fileURLToPath(new URL('./tmp/share-connections.json',import.meta.url)),
        allowedOrigins:(env.SHARE_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean),
        turnSecret:env.SHARE_TURN_SECRET,turnUrls:(env.SHARE_TURN_URLS||'').split(',').map(value=>value.trim()).filter(Boolean)}))
    },
  }],
  build: {
    rolldownOptions: {
      input: { app: fileURLToPath(new URL('./index.html', import.meta.url)), mockup: fileURLToPath(new URL('./design/mockup.html', import.meta.url)) },
    },
  },
  resolve: {
    alias: {
      // shadcn/ui 컴포넌트가 기대하는 `@/*` 별칭. tsconfig.app.json의 paths와 짝을 맞춘다.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
