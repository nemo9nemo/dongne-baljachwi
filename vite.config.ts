import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // shadcn/ui 컴포넌트가 기대하는 `@/*` 별칭. tsconfig.app.json의 paths와 짝을 맞춘다.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
