import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // Windows can intermittently lock files in dist/ (AV/indexer).
    // Avoid failing builds due to outDir cleanup; Vite will overwrite changed assets.
    emptyOutDir: false,
  },
});
