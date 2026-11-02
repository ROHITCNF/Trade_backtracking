import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev the API runs on :4000 (npm run api at the repo root); proxying keeps
// the browser on one origin. In production VITE_API_URL points at Render.
// Tailwind serves the shadcn/ui components only (src/styles/shadcn.css);
// `@` is shadcn's import alias for src/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/auth': 'http://127.0.0.1:4000',
    },
  },
});
