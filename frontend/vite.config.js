import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api calls are proxied to the Express backend, so no CORS setup is needed in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
