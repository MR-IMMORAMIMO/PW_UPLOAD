import { studioIntegration } from './studioIntegration';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolveV4Base } from './src/base-resolve';
import { fileURLToPath } from 'node:url';
import { v4BuildProvenance } from './buildProvenance';

/**
 * V4 clean renderer Vite configuration.
 *
 * - Port 5174 avoids clashing with the legacy renderer (5173) during parallel
 *   development.
 * - The `/api` proxy reaches the canonical local API (same authority as legacy).
 * - The renderer asset base is derived from the SAME `VITE_V4_BASE_PATH`
 *   environment variable that the router basename reads (see
 *   `src/router/base-path.ts`), so built JS/CSS/public assets resolve from the
 *   correct mount (`/v4` during parallel development, `/` after cutover).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = resolveV4Base(env.VITE_V4_BASE_PATH, '/v4');
  const provenance = v4BuildProvenance(fileURLToPath(new URL('../..', import.meta.url)));

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      provenance.plugin,
      studioIntegration(fileURLToPath(new URL('../..', import.meta.url))),
    ],
    define: { __SCT_V4_BUILD__: JSON.stringify(provenance.metadata) },
    server: {
      port: Number(process.env.VITE_PORT ?? 5174),
      strictPort: true,
      proxy: {
        '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
