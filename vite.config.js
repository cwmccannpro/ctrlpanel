import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CTRLpanel frontend dev server. Proxies /api → Express backend on :3001
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
