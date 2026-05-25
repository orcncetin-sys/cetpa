import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // GEMINI_API_KEY is intentionally NOT injected here — it lives server-side only.
      // Client components must call /api/ai/* proxy routes instead.
      'process.env.GOOGLE_MAPS_PLATFORM_KEY': JSON.stringify(env.GOOGLE_MAPS_PLATFORM_KEY || ''),
      'process.env.SHOPIFY_API_KEY': JSON.stringify(env.SHOPIFY_API_KEY || ''),
      'process.env.SHOPIFY_STORE_URL': JSON.stringify(env.SHOPIFY_STORE_URL || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Firebase SDK → its own chunk
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'vendor-firebase';
            }
            // PDF generation → lazy-loaded chunk
            if (id.includes('node_modules/jspdf')) {
              return 'vendor-jspdf';
            }
            // Leaflet maps → lazy-loaded chunk
            if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) {
              return 'vendor-leaflet';
            }
            // Lucide icons → its own chunk
            if (id.includes('node_modules/lucide-react')) {
              return 'vendor-lucide';
            }
            // Recharts + D3 → its own chunk
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
              return 'vendor-charts';
            }
            // All other node_modules → shared vendor chunk
            if (id.includes('node_modules')) {
              return 'vendor';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
