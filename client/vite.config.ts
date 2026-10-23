import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  preview: { port: 4173, strictPort: true, allowedHosts: process.env.PREVIEW_HOST ? [process.env.PREVIEW_HOST] : [], proxy: { "/api": { target: "http://127.0.0.1:3000", ws: true } } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', ws: true } },
  },
});
