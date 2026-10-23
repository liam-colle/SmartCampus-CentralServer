import { describe, expect, it } from "vitest";
import { EMERGENCY_CATALOGUE, EMERGENCY_KINDS, MAX_FRAME_BYTES, buildMessage, displayConfig, handshakeMessages, isUlid, parseDeviceMessage, parseServerMessage, ulid } from "./index.js";

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

const occupied = { roomId: "B2-104", status: "occupied", label: "Occupied", color: "#f5a524", icon: "user" } as const;

describe("messages", () => {
  it("round-trips a server command", () => {
    const msg = buildMessage({ type: "room.status.set", payload: occupied }, 1);
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
    const ok = buildMessage({ type: "room.status.set", payload: { ...occupied, status: "free" } }, 1);
    expect(parseServerMessage(JSON.stringify({ ...ok, type: "nope" })).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ ...ok, payload: { ...occupied, status: "Not A Key" } })).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ ...ok, v: 2 })).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ ...ok, id: "x" })).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ ...ok, seq: 0 })).ok).toBe(false);
  });

  it("does not accept a message in the wrong direction", () => {
    const ack = buildMessage({ type: "ack", payload: { ref: ulid() } }, 1);
    expect(parseServerMessage(JSON.stringify(ack)).ok).toBe(false);
    const cmd = buildMessage({ type: "room.status.set", payload: { ...occupied, status: "free" } }, 1);
    expect(parseDeviceMessage(JSON.stringify(cmd)).ok).toBe(false);
  });

  it("rejects invalid JSON and oversized frames", () => {
    expect(parseDeviceMessage("{nope").ok).toBe(false);
    expect(parseDeviceMessage("x".repeat(MAX_FRAME_BYTES + 1)).ok).toBe(false);
  });

  it("audio.play carries a hash and size, not audio", () => {
    const bad = buildMessage({ type: "audio.play", payload: { announcementId: "n", assetId: "a", sha256: "zz", size: 10 } }, 1);
    expect(parseServerMessage(JSON.stringify(bad)).ok).toBe(false);
  });

  it("a status needs a hex colour and a known icon", () => {
    const parse = (over: object) =>
      parseServerMessage(JSON.stringify(buildMessage({ type: "room.status.set", payload: { ...occupied, ...over } }, 1))).ok;
    expect(parse({})).toBe(true);
    expect(parse({ color: "red" })).toBe(false);
    expect(parse({ icon: "skull" })).toBe(false);
    expect(parse({ label: "" })).toBe(false);
  });

  it("announcements use info, important and urgent", () => {
    const parse = (priority: string) =>
      parseServerMessage(JSON.stringify(buildMessage({ type: "announce.show", payload: { announcementId: "a", text: "x", priority } } as never, 1))).ok;
    expect(parse("urgent")).toBe(true);
    expect(parse("high")).toBe(false);
  });

  it("emergencies need a known kind and a bounded test volume", () => {
    const base = { emergencyId: "e1", kind: "fire", title: "Fire alarm", instructions: "Leave.", startedAt: 1 };
    const parse = (over: object) =>
      parseServerMessage(JSON.stringify(buildMessage({ type: "emergency.set", payload: { ...base, ...over } } as never, 1)));
    const ok = parse({});
    expect(ok.ok && ok.message.payload).toMatchObject({ testMode: false, testVolume: 20 });
    expect(parse({ kind: "zombies" }).ok).toBe(false);
    expect(parse({ testVolume: 101 }).ok).toBe(false);
    expect(parse({ instructions: "" }).ok).toBe(false);
  });

  it("every emergency kind has wording and a colour", () => {
    for (const kind of EMERGENCY_KINDS) {
      const info = EMERGENCY_CATALOGUE[kind];
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.instructions.length).toBeLessThanOrEqual(400);
      expect(info.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("audio settings bound the volume", () => {
    const quietHours = { enabled: true, from: "22:00", to: "06:00" };
    const parse = (volume: number) =>
      parseServerMessage(JSON.stringify(buildMessage({ type: "audio.settings.set", payload: { volume, quietHours } }, 1))).ok;
    expect(parse(0)).toBe(true);
    expect(parse(100)).toBe(true);
    expect(parse(101)).toBe(false);
    expect(parse(-1)).toBe(false);
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

describe("display config", () => {
  it("fills every default from an empty object", () => {
    const config = displayConfig.parse({});
    expect(config).toMatchObject({ layout: "standard", theme: "dark", accentColor: "#00a86b" });
    expect(config.show.clock).toBe(true);
    expect(config.sleep).toEqual({ enabled: false, from: "22:00", to: "06:00" });
  });

  it("rejects an unknown layout, a bad colour and a bad time", () => {
    expect(displayConfig.safeParse({ layout: "grid" }).success).toBe(false);
    expect(displayConfig.safeParse({ accentColor: "green" }).success).toBe(false);
    expect(displayConfig.safeParse({ sleep: { from: "25:00" } }).success).toBe(false);
  });
});
