import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Frontend unit tests only. The *.test.ts files under supabase/functions are
// Deno tests (Deno.test, URL imports) and run with `npm run test:functions`;
// a bare `vitest run` used to pick them up too and fail on every one.
//
// Merged onto vite.config.ts rather than replacing it, because vitest has
// always loaded that config implicitly and the tests ran under it.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);
