import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
 const env = loadEnv(mode,fileURLToPath(new URL('../../',import.meta.url)),'');
 return { plugins: [react(),tailwind()], server: { port: 5173, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${env.PORT ?? '3001'}`, changeOrigin: true } } } };
});
