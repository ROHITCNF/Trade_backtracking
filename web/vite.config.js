import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the API runs on :4000 (npm run api at the repo root); proxying keeps
// the browser on one origin. In production VITE_API_URL points at Render.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/auth': 'http://127.0.0.1:4000',
    },
  },
});
