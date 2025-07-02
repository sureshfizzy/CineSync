import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from one directory above WebDavHub
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const uiPort = process.env.CINESYNC_UI_PORT ? parseInt(process.env.CINESYNC_UI_PORT, 10) : 5173;
const apiPort = process.env.CINESYNC_API_PORT ? parseInt(process.env.CINESYNC_API_PORT, 10) : 8082;
const host = process.env.CINESYNC_IP || true;

// TMDB API key with fallback mechanism
function getTmdbApiKey(): string {
  const envKey = (process.env.TMDB_API_KEY || '').trim();

  const placeholderValues = [
    '',
    'your_tmdb_api_key_here',
    'your-tmdb-api-key',
    'placeholder',
    'none',
    'null'
  ];

  if (!envKey || placeholderValues.includes(envKey.toLowerCase())) {
    return 'a4f28c50ae81b7529a05b61910d64398';
  }

  return envKey;
}

const tmdbApiKey = getTmdbApiKey();

const getAllowedHosts = (): true | string[] => {
  const envHosts = process.env.VITE_ALLOWED_HOSTS;
  if (envHosts) {
    return envHosts.split(',').map(host => host.trim());
  }
  return true;
};

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    port: uiPort,
    allowedHosts: getAllowedHosts(),
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host,
    port: uiPort,
    allowedHosts: getAllowedHosts(),
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          'vendor-react': ['react', 'react-dom'],
          'vendor-mui': ['@mui/material', '@mui/icons-material'],
          'vendor-router': ['react-router-dom'],
          'vendor-utils': ['axios', 'date-fns'],
          'vendor-media': ['video.js', 'react-player'],
          'vendor-animation': ['framer-motion'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  define: {
    'import.meta.env.VITE_TMDB_API_KEY': JSON.stringify(tmdbApiKey),
  },
});
