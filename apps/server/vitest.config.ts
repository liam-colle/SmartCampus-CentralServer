import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests start an in-memory MongoDB and a real HTTP/WebSocket server.
    testTimeout: 15_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
