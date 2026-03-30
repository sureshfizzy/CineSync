import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from db directory
function getEnvFilePath(): string {
  if (process.env.CONTAINER === 'docker') {
    return path.resolve('/app/db/.env');
  }

  const cwd = process.cwd();
  const basename = path.basename(cwd);

  if (basename === 'WebDavHub' || basename === 'MediaHub') {
    const parentDir = path.dirname(cwd);
    return path.join(parentDir, 'db', '.env');
  }

  return path.join(cwd, 'db', '.env');
}

const envPath = getEnvFilePath();
dotenv.config({ path: envPath });

const uiPort = process.env.VITE_DEV_PORT ? parseInt(process.env.VITE_DEV_PORT, 10) : 5173;
const apiPort = process.env.CINESYNC_PORT ? parseInt(process.env.CINESYNC_PORT, 10) : 8082;
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

const chunkGroups = [
  { name: 'vendor-react', packages: ['react', 'react-dom'] },
  { name: 'vendor-mui', packages: ['@mui/material', '@mui/icons-material'] },
  { name: 'vendor-router', packages: ['react-router-dom'] },
  { name: 'vendor-utils', packages: ['axios', 'date-fns'] },
  { name: 'vendor-media', packages: ['video.js', 'react-player'] },
  { name: 'vendor-animation', packages: ['framer-motion'] },
];

function getManualChunk(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, '/');

  if (!normalizedId.includes('/node_modules/')) {
    return undefined;
  }

  for (const chunkGroup of chunkGroups) {
    for (const pkg of chunkGroup.packages) {
      if (normalizedId.includes(`/node_modules/${pkg}/`)) {
        return chunkGroup.name;
      }
    }
  }

  return undefined;
}

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
        manualChunks: getManualChunk,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  define: {
    'import.meta.env.VITE_TMDB_API_KEY': JSON.stringify(tmdbApiKey),
  },
});
