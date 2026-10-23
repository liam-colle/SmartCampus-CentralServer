import { fingerprint } from "@smartcampus/handshake";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../../testing/harness.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(() => h.stop());

describe("server key", () => {
  it("is public and gives the key the gateway proves with, plus its fingerprint", async () => {
    const res = await h.anonymous.request("GET", "/server-key");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["fingerprint", "publicKey"]);
    expect(res.body.fingerprint).toBe(fingerprint(res.body.publicKey));
    // A terminal that pins this key must be able to complete the handshake with the gateway.
    const { identity, deviceId } = await h.enrollDevice();
    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    expect(dev.handshakeError).toBeNull();
    dev.close();
  });

  it("never returns private key material", async () => {
    const res = await h.anonymous.raw("GET", "/server-key");
    expect(await res.text()).not.toMatch(/PRIVATE|privateKey/i);
  });
});
