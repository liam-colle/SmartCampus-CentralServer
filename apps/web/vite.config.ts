import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: true,
    port: 5173,
    // File events from bind mounts don't always reach the container (Docker on WSL/macOS).
    watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === "true" },
    // The browser only ever talks to this origin, so the session cookie is first-party.
    proxy: {
      "/api": { target: process.env.BACKEND_URL ?? "http://localhost:3000" },
    },
  },
});
