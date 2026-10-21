import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: process.env.BASE_PATH || './', plugins: [react()], server: { host: '127.0.0.1', port: 5175 }, build: { target: 'es2022', manifest: 'asset-manifest.json' } });
