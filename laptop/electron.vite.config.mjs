import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Justin's one-time step: copy oauth.config.example.json -> oauth.config.json and fill it.
// The values are compiled into the build so the exe can be handed over as a single file.
let baked = {};
try {
  // tolerate a UTF-8 BOM — Notepad and Windows PowerShell both like to add one
  const raw = readFileSync(new URL('./oauth.config.json', import.meta.url), 'utf8');
  baked = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
} catch {
  // no baked config — the app falls back to a sidecar neku.config.json or the in-app setup screen
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __NEKU_BAKED__: JSON.stringify(baked),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        // two pages, not one: the workbench, and the corner notice that appears
        // over the browser when a gif lands in Downloads (src/main/notice.js)
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          notice: resolve(import.meta.dirname, 'src/renderer/notice.html'),
        },
      },
    },
  },
});
