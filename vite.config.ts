import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4191,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4190' },
  },
  build: { target: 'es2022', emptyOutDir: true },
});
