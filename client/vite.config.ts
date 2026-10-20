import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const SERVER = 'http://localhost:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
