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
const tmdbApiKey = process.env.TMDB_API_KEY;

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
  define: {
    'import.meta.env.VITE_TMDB_API_KEY': JSON.stringify(tmdbApiKey),
  },
});
