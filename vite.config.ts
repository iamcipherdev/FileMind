import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Forked pool: every test file runs in its own PROCESS. Required because
    // diagnostic-variant tests toggle FILEMIND_DISABLE_* env vars; with the
    // default threads pool worker threads share process.env, which flakily
    // contaminates unrelated test files (observed on Windows CI).
    pool: 'forks',
  },
} as never);
