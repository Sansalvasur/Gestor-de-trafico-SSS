import { defineConfig } from 'vite';

export default defineConfig({
    // El index.html está en la raíz, Vite lo toma como entrada por defecto
    root: '.',
    build: {
        outDir: 'dist'
    },
    server: {
        port: 5173
    }
});
