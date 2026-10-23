import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isConsoleOrigin } from "../../config.js";
import { startHarness, type Harness } from "../../testing/harness.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(() => h.stop());

const login = (origin?: string) =>
  fetch(`${h.origin}/api/auth/logout`, { method: "POST", headers: origin ? { origin } : {} });

describe("console origins", () => {
  it("accepts APP_URL and every ALLOWED_ORIGINS entry, nothing else", () => {
    expect(isConsoleOrigin("http://localhost:5173")).toBe(true);
    expect(isConsoleOrigin("http://10.0.0.5:5173")).toBe(true);
    expect(isConsoleOrigin("http://192.168.1.20:3000")).toBe(true);
    expect(isConsoleOrigin("http://10.0.0.5:3000")).toBe(false); // same host, other port: other origin
    expect(isConsoleOrigin("http://evil.example")).toBe(false);
  });

  it("lets a state-changing request from an allowed LAN origin through and blocks a foreign one", async () => {
    expect((await login("http://10.0.0.5:5173")).status).not.toBe(403);
    expect((await login("http://evil.example")).status).toBe(403);
    expect((await login()).status).not.toBe(403); // no Origin header: not a browser cross-site request
  });
});
