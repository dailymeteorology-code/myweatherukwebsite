import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
/* the site's version, 5.##.### (version.json, bumped with every save: scripts/version.mjs, VERSIONS.md) */
const siteVersion = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'version.json'), 'utf8')).version; } catch { return pkg.version; } })();
const API_PORT = process.env.API_PORT || 8787;

// Self-hosted build: no @base44/vite-plugin, no Base44 SDK.
// The "@/" alias and the /api proxy are all the app needs.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(here, 'src') },
  },
  plugins: [react()],
  define: {
    // The site's version in the corner of every page: numbers only, 5.##.### (version.json).
    __APP_VERSION__: JSON.stringify(siteVersion),
  },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/uploads': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
