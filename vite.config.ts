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
    rollupOptions: {
      output: {
        // Stable vendor chunks so app-only deploys don't invalidate ~180KB of
        // rarely-changing code for returning visitors (pairs with the immutable
        // caching rule in public/_headers). react/react-dom/router must stay in
        // ONE chunk (splitting them causes init-order crashes); supabase has no
        // React dependency so it's safe standalone. Do NOT add react-dependent
        // libs (lucide-react, @radix-ui/*) here -- they belong with the app code.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js', '@supabase/ssr'],
        },
      },
    },
  },
});
