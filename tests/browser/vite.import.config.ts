import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Add a test page to an existing local build. A normal `npm run build` removes it.
export default defineConfig({plugins:[react()], build:{emptyOutDir:false,
  rollupOptions:{input:'tests/browser/files.html'}}});
