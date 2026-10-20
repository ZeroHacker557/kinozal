import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    fs: { allow: ['..'] },
    // Realtime server (node server/src/index.ts) bilan bir xil manzildan ishlash
    proxy: { '/ws': { target: 'ws://localhost:2567', ws: true } },
  },
  build: { chunkSizeWarningLimit: 2500 },
});
