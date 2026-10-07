import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{emptyOutDir:false,rollupOptions:{input:['tests/browser/files.html','tests/browser/decks.html']}}});
