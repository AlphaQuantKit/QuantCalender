import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // The production site uses a custom domain. VITE_BASE_PATH can still be set
  // to /repository-name/ when previewing from a project-scoped Pages URL.
  base: process.env.VITE_BASE_PATH || '/',
  build: { sourcemap: false },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] }
})
