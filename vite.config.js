import { defineConfig } from 'vite';

export default defineConfig({
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
