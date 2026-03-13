import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { renameSync } from 'fs';
import { resolve } from 'path';

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    svelte(),
    // singlefile + rename only for production build
    ...(command === 'build' ? [
      viteSingleFile(),
      {
        name: 'rename-to-dashboard',
        closeBundle() {
          const outDir = resolve(__dirname, '../templates');
          try {
            renameSync(
              resolve(outDir, 'index.html'),
              resolve(outDir, 'dashboard.html')
            );
          } catch {}
        }
      }
    ] : []),
  ],
  build: {
    outDir: resolve(__dirname, '../templates'),
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8484',
      '/ws': {
        target: 'http://localhost:8484',
        ws: true,
        changeOrigin: true,
      },
    },
  },
}));
