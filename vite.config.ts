import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// During development the React app runs on Vite (port 5173) and the API
// runs on Express (port 3001). This proxy forwards /api/* calls so the
// browser only ever talks to one origin.
const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [
    react(),

    // PWA support: generates a service worker + web app manifest so the
    // demo can be "installed" to a phone's home screen and feel native.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'AI Voice Agent Demo',
        short_name: 'Voice Agent',
        description: 'AI voice agent demo built with TRTC Conversational AI',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell; API calls and TRTC media are always live.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
