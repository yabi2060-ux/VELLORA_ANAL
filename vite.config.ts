/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

const stub = fileURLToPath(new URL('./src/lib/stubs/empty.ts', import.meta.url));

// `vite build`                    → normal production build in dist/ (host this)
// `vite build --mode singlefile`  → one self-contained HTML (VELLORA-preview.html) for mobile code editors
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    resolve: { alias: { html2canvas: stub, dompurify: stub, canvg: stub } },
    build: single
      ? { outDir: 'dist-preview', assetsInlineLimit: 100_000_000, cssCodeSplit: false, emptyOutDir: true }
      : { outDir: 'dist', assetsInlineLimit: 4096, emptyOutDir: true, chunkSizeWarningLimit: 900 },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
