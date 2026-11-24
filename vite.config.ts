// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
      // The user stream (oe-stream). Listed BEFORE '/ws': Vite matches proxy
      // contexts in key order, so '/ws/v2' must win over the market-data
      // service's '/ws' prefix. Point it at your local STREAM_WS_BIND.
      '/ws/v2': {
        target: 'ws://localhost:8084',
        ws: true,
      },
      // The market-data service (oe-marketdata, MD_PUBLIC_BIND).
      '/ws': {
        target: 'ws://localhost:8081',
        ws: true,
      },
      // The REST gateway (oe-gateway, GATEWAY_HTTP_BIND).
      '/api/v2': {
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
    allowedHosts: ['trade.openexchange.dev', 'localhost'],
    proxy: {
      // Keep in sync with server.proxy above ('/ws/v2' before '/ws').
      '/ws/v2': {
        target: 'ws://localhost:8084',
        ws: true,
      },
      '/ws': {
        target: 'ws://localhost:8081',
        ws: true,
      },
      '/api/v2': {
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
})
