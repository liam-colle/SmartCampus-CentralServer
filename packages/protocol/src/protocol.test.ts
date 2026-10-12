import { describe, expect, it } from "vitest";
import { MAX_FRAME_BYTES, buildMessage, handshakeMessages, isUlid, parseDeviceMessage, parseServerMessage, ulid } from "./index.js";

describe("ulid", () => {
  it("is 26 Crockford chars and sortable by time", () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    expect(isUlid(a)).toBe(true);
    expect(a < b).toBe(true);
  });
  it("does not collide", () => {
    expect(new Set(Array.from({ length: 5000 }, () => ulid())).size).toBe(5000);
  });
});

describe("messages", () => {
  it("round-trips a server command", () => {
    const msg = buildMessage({ type: "room.status.set", payload: { roomId: "B2-104", status: "occupied" } }, 1);
    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed).toEqual({ ok: true, message: msg });
  });

  it("round-trips device messages", () => {
    const ack = buildMessage({ type: "ack", payload: { ref: ulid() } }, 3);
    expect(parseDeviceMessage(JSON.stringify(ack)).ok).toBe(true);
  });

  it("keeps the given id when replaying a command", () => {
    const id = ulid();
    expect(buildMessage({ type: "ack", payload: { ref: ulid() }, id }, 1).id).toBe(id);
  });

  it("rejects unknown types, bad payloads, wrong version and bad ids", () => {
    const ok = buildMessage({ type: "room.status.set", payload: { roomId: "r", status: "free" } }, 1);
    expect(parseServerMessage(JSON.stringify({ ...ok, type: "nope" })).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ ...ok, payload: { roomId: "r", status: "exploded" } })).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ ...ok, v: 2 })).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ ...ok, id: "x" })).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ ...ok, seq: 0 })).ok).toBe(false);
  });

  it("does not accept a message in the wrong direction", () => {
    const ack = buildMessage({ type: "ack", payload: { ref: ulid() } }, 1);
    expect(parseServerMessage(JSON.stringify(ack)).ok).toBe(false);
    const cmd = buildMessage({ type: "room.status.set", payload: { roomId: "r", status: "free" } }, 1);
    expect(parseDeviceMessage(JSON.stringify(cmd)).ok).toBe(false);
  });

  it("rejects invalid JSON and oversized frames", () => {
    expect(parseDeviceMessage("{nope").ok).toBe(false);
    expect(parseDeviceMessage("x".repeat(MAX_FRAME_BYTES + 1)).ok).toBe(false);
  });

  it("audio.play carries a hash and size, not audio", () => {
    const bad = buildMessage({ type: "audio.play", payload: { assetId: "a", sha256: "zz", size: 10 } }, 1);
    expect(parseServerMessage(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe("handshake messages", () => {
  const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");
  it("validate sizes", () => {
    const good = { type: "hello", v: 1, deviceId: ulid(), nonceA: b64(32), ephA: b64(65) };
    expect(handshakeMessages.hello.safeParse(good).success).toBe(true);
    expect(handshakeMessages.hello.safeParse({ ...good, nonceA: b64(16) }).success).toBe(false);
    expect(handshakeMessages.hello.safeParse({ ...good, ephA: b64(33) }).success).toBe(false);
  });
});
