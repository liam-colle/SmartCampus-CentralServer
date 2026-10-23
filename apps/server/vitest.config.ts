import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests start an in-memory MongoDB and a real HTTP/WebSocket server.
    testTimeout: 15_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: { ALLOWED_ORIGINS: "http://10.0.0.5:5173, http://192.168.1.20:3000" },
  },
});
