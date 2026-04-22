import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/livekit': 'http://localhost:3000',
      '/hospitals': 'http://localhost:3000',
      '/appointments': 'http://localhost:3000',
    },
  },
});
