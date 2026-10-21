import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';

// Marca cada compilación en el service worker para que el navegador detecte versiones nuevas
function stampServiceWorker() {
    return {
        name: 'stamp-service-worker',
        apply: 'build',
        closeBundle() {
            const file = 'dist/sw.js';
            const buildId = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());
            writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_ID__', buildId));
        }
    };
}

export default defineConfig({
    plugins: [stampServiceWorker()],
    root: '.',
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: 'index.html',
                mapa: 'mapa/map.html'
            }
        }
    },
    server: {
        port: 5173
    }
});
