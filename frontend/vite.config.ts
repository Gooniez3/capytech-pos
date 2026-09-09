import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';

const certKeyPath = fileURLToPath(
  new URL('./certs/key.pem', import.meta.url)
);
const certPath = fileURLToPath(
  new URL('./certs/cert.pem', import.meta.url)
);
const https =
  fs.existsSync(certKeyPath) && fs.existsSync(certPath)
    ? {
        key: fs.readFileSync(certKeyPath),
        cert: fs.readFileSync(certPath),
      }
    : undefined;

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  optimizeDeps: {
    exclude: ['lucide-react'],
  },

  server: {
    host: '0.0.0.0',
    port: 5173,
    https,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
