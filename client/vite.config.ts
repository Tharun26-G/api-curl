import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: any;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const apiUrl = env.VITE_API_URL || '';
  const proxy =
    apiUrl && /^https?:\/\//i.test(apiUrl)
      ? {
          '/api': {
            target: apiUrl,
            changeOrigin: true,
          },
        }
      : undefined;

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT) || 5173,
      proxy,
    },
  };
});