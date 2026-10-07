import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root:fileURLToPath(new URL('./demo',import.meta.url)),
  publicDir:fileURLToPath(new URL('./public',import.meta.url)),
  base:process.env.DEMO_BASE_PATH || '/modoo-cards/',
  plugins:[react()],
  // The static demo must never inherit a private installation's API setting.
  envDir:false,
  define:{'import.meta.env.VITE_API_ORIGIN':JSON.stringify('')},
  server:{host:'127.0.0.1',port:4193,strictPort:true},
  build:{outDir:fileURLToPath(new URL('./dist-demo',import.meta.url)),emptyOutDir:true,target:'es2022'},
});
