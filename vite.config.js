import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CTRLpanel frontend dev server. Proxies /api → Express backend on :3001
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Libraries that rarely change get their own files, so shipping new app code
        // doesn't make returning visitors re-download React or the Supabase client.
        // (Pages, charts, markdown, Excalidraw… are already split by lazy routes.)
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return 'react-vendor';
          if (/node_modules\/@supabase\//.test(id)) return 'supabase';
          return undefined;
        },
      },
    },
  },
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
