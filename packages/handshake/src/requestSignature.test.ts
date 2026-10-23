import { describe, expect, it } from "vitest";
import { REQUEST_MAX_SKEW_MS, generateIdentity, signRequest, verifyRequest } from "./index.js";

const device = generateIdentity();
const NOW = 1_800_000_000_000;
const path = "/api/assets/01ABC/download";

describe("signed requests", () => {
  it("verifies a request signed by the device key", () => {
    const req = signRequest(device.privateKey, "get", path, NOW);
    expect(req.method).toBe("GET");
    expect(verifyRequest(device.publicKey, req, NOW)).toBe(true);
  });

  it("rejects another key, another path, another method and a tampered signature", () => {
    const req = signRequest(device.privateKey, "GET", path, NOW);
    expect(verifyRequest(generateIdentity().publicKey, req, NOW)).toBe(false);
    expect(verifyRequest(device.publicKey, { ...req, path: "/api/assets/01XYZ/download" }, NOW)).toBe(false);
    expect(verifyRequest(device.publicKey, { ...req, method: "POST" }, NOW)).toBe(false);
    expect(verifyRequest(device.publicKey, { ...req, signature: "AAAA" }, NOW)).toBe(false);
  });

  it("rejects stale and future timestamps but accepts the allowed skew", () => {
    const req = signRequest(device.privateKey, "GET", path, NOW);
    expect(verifyRequest(device.publicKey, req, NOW + REQUEST_MAX_SKEW_MS)).toBe(true);
    expect(verifyRequest(device.publicKey, req, NOW + REQUEST_MAX_SKEW_MS + 1)).toBe(false);
    expect(verifyRequest(device.publicKey, req, NOW - REQUEST_MAX_SKEW_MS - 1)).toBe(false);
  });

  it("rejects a malformed timestamp instead of throwing", () => {
    const req = signRequest(device.privateKey, "GET", path, NOW);
    expect(verifyRequest(device.publicKey, { ...req, timestamp: "soon" }, NOW)).toBe(false);
  });
});
