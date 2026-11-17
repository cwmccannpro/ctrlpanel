import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: { outDir: 'dist-android', target: 'chrome90', rollupOptions: { input: 'tablet.html' } },
});
