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

  const appUrl = env.VITE_APP_URL || 'http://localhost:5173';
  let clientPort = 5173;
  try {
    const parsedUrl = new URL(appUrl);
    if (parsedUrl.port) {
      clientPort = Number(parsedUrl.port);
    } else {
      clientPort = parsedUrl.protocol === 'https:' ? 443 : 80;
    }
  } catch (e) {
    // fallback
  }

  return {
    plugins: [react()],
    server: {
      port: clientPort,
      proxy,
    },
  };
});