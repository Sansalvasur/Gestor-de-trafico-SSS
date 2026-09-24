import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: '.',
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, 'index.html'),
                mapa: resolve(import.meta.dirname, 'mapa/index.html')
            }
        }
    },
    server: {
        port: 5173
    }
});
