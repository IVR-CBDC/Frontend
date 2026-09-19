import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Alfa Global CBDC Hub",
        short_name: "CBDC Hub",
        description: "Личный кабинет для сопровождения внешнеэкономических сделок от начала до завершения.",
        theme_color: "#0B1F3A",
        background_color: "#0B1F3A",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // BFF на 127.0.0.1:14000 — этот порт проброшен из стенда Backend-репозитория
      // только dev-оверлеем docker-compose.dev.yml (см. README «Контракт для SPA»).
      "/api": { target: "http://127.0.0.1:14000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:14000", ws: true },
    },
  },
});
