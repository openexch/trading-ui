// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: '/',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    server: {
        port: 80,
        proxy: {
            // OMS user-scoped socket (oms#72). Listed BEFORE '/ws': Vite matches
            // proxy contexts in key order, so '/ws/v1' must win over the market
            // gateway's '/ws' prefix.
            '/ws/v1': {
                target: 'ws://localhost:8080',
                ws: true,
            },
            '/ws': {
                target: 'ws://localhost:8081',
                ws: true,
            },
            '/api/v1': {
                target: 'http://localhost:8080',
                changeOrigin: true,
            },
            '/api/admin': {
                target: 'http://localhost:8082',
                changeOrigin: true,
            },
            '/api/candles': {
                target: 'http://localhost:8081',
                changeOrigin: true,
            },
        },
    },
    preview: {
        port: 80,
        allowedHosts: ['trade.openexch.io', 'localhost'],
        proxy: {
            // Keep in sync with server.proxy above ('/ws/v1' before '/ws').
            '/ws/v1': {
                target: 'ws://localhost:8080',
                ws: true,
            },
            '/ws': {
                target: 'ws://localhost:8081',
                ws: true,
            },
            '/api/v1': {
                target: 'http://localhost:8080',
                changeOrigin: true,
            },
            '/api/admin': {
                target: 'http://localhost:8082',
                changeOrigin: true,
            },
            '/api/candles': {
                target: 'http://localhost:8081',
                changeOrigin: true,
            },
        },
    },
});
