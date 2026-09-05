import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // allows phone on the same WiFi to reach the dev server
    port: 3000,
  },
});
