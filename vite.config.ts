import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: Number(process.env.PORT ?? 5180),
    proxy: { '/api': `http://localhost:${process.env.AIVALON_API_PORT ?? 8787}` },
  },
});
