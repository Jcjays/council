import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Point the dev proxy at another Council server with COUNCIL_SERVER=http://localhost:4318
// and move the dev client itself with COUNCIL_CLIENT_PORT=5174 (both optional).
const SERVER = process.env.COUNCIL_SERVER ?? 'http://localhost:4317';
const PORT = Number(process.env.COUNCIL_CLIENT_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: PORT,
    strictPort: true,
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
