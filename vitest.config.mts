import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The journal's rules are plain functions and test fastest in node. A test that
// needs a DOM or IndexedDB asks for one itself, with a `@vitest-environment
// jsdom` docblock at the top of the file, so the fast tests stay fast.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      'server-only': new URL('./src/test/server-only-stub.ts', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
