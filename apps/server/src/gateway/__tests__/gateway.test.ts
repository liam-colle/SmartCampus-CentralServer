import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateIdentity, publicKeyOf, type Identity } from "@smartcampus/handshake";
import { CloseCode, ulid } from "@smartcampus/protocol";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueCommand } from "../../domain/commands.js";
import {
  approveRequest,
  denyRequest,
  enrollmentStatus,
  listPendingRequests,
  requestEnrollment,
  revokeDevice,
} from "../../domain/devices.js";
import { consoleBus } from "../consoleBus.js";
import { CommandModel } from "../../models/command.js";
import { DeviceModel } from "../../models/device.js";
import { attachGateway } from "../index.js";
import { registry } from "../registry.js";
import { TestDevice } from "./testDevice.js";

let mongo: MongoMemoryServer;
let http: Server;
let gateway: ReturnType<typeof attachGateway>;
let url: string;
const occupied = { roomId: "B2-104", status: "occupied", label: "Occupied", color: "#f5a524", icon: "user" } as const;
const serverKey = generateIdentity();
const serverPublicKey = publicKeyOf(serverKey.privateKey);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await DeviceModel.init();
  await CommandModel.init();

  http = createServer();
  gateway = attachGateway(http, {
    serverPrivateKey: serverKey.privateKey,
    pingIntervalMs: 80,
    handshakeTimeoutMs: 400,
    maxConnectsPerMinute: 1000,
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  gateway.close();
  http.close();
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await DeviceModel.deleteMany({});
  await CommandModel.deleteMany({});
});

/** Runs the real enrollment (request, then approval from the console) and returns an active device. */
async function enrolled(type: "door" | "display" | "access" = "door") {
  const identity = generateIdentity();
  const req = await requestEnrollment({ publicKey: identity.publicKey, type, name: "Test device" });
  await approveRequest(req.deviceId, {});
  return { identity, deviceId: req.deviceId, req };
}

const connect = (deviceId: string, identity: Identity, opts = {}) =>
  new TestDevice(url, deviceId, identity.privateKey, serverPublicKey, opts);

describe("enrollment", () => {
  it("a request waits for approval, then the device may connect", async () => {
    const identity = generateIdentity();
    const req = await requestEnrollment({ publicKey: identity.publicKey, type: "door", name: "lobby door", ip: "10.0.0.7" });
    expect(await enrollmentStatus(req.deviceId)).toBe("pending");

    const pending = await listPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ deviceId: req.deviceId, name: "lobby door", requestIp: "10.0.0.7", fingerprint: req.fingerprint });

    const device = await approveRequest(req.deviceId, { name: "Door B2-104", groups: ["floor-2"] });
    expect(device).toMatchObject({ status: "active", name: "Door B2-104", groups: ["floor-2"] });
    expect(device.enrollExpiresAt).toBeUndefined();
    expect(await enrollmentStatus(req.deviceId)).toBe("active");
    expect(await listPendingRequests()).toHaveLength(0);
  });

  it("keeps the name the device asked for unless the admin gives another", async () => {
    const identity = generateIdentity();
    const req = await requestEnrollment({ publicKey: identity.publicKey, type: "door", name: "lobby door" });
    expect((await approveRequest(req.deviceId, {})).name).toBe("lobby door");
  });

  it("a denied request never authenticates and the key cannot ask again at once", async () => {
    const identity = generateIdentity();
    const req = await requestEnrollment({ publicKey: identity.publicKey, type: "door" });
    await denyRequest(req.deviceId);
    expect(await enrollmentStatus(req.deviceId)).toBe("denied");
    await expect(requestEnrollment({ publicKey: identity.publicKey, type: "door" })).rejects.toThrow(/denied/);
    await expect(approveRequest(req.deviceId, {})).rejects.toThrow(/not found or expired/);

    const dev = connect(req.deviceId, identity);
    expect(await dev.closed).toBe(CloseCode.AuthFailed);
  });

  it("a request can only be resolved once", async () => {
    const identity = generateIdentity();
    const req = await requestEnrollment({ publicKey: identity.publicKey, type: "door" });
    await approveRequest(req.deviceId, {});
    await expect(approveRequest(req.deviceId, {})).rejects.toThrow(/not found or expired/);
    await expect(denyRequest(req.deviceId)).rejects.toThrow(/not found or expired/);
  });

  it("retrying with the same key while pending returns the same request", async () => {
    const identity = generateIdentity();
    const first = await requestEnrollment({ publicKey: identity.publicKey, type: "door" });
    const again = await requestEnrollment({ publicKey: identity.publicKey, type: "door" });
    expect(again.deviceId).toBe(first.deviceId);
    expect(await DeviceModel.countDocuments()).toBe(1);
  });

  it("expired requests cannot be approved, and the key may ask again", async () => {
    const identity = generateIdentity();
    const req = await requestEnrollment({ publicKey: identity.publicKey, type: "door" });
    await DeviceModel.updateOne({ deviceId: req.deviceId }, { enrollExpiresAt: new Date(Date.now() - 1000) });
    expect(await enrollmentStatus(req.deviceId)).toBe("expired");
    expect(await listPendingRequests()).toHaveLength(0);
    await expect(approveRequest(req.deviceId, {})).rejects.toThrow(/not found or expired/);
    const renewed = await requestEnrollment({ publicKey: identity.publicKey, type: "door" });
    expect(renewed.deviceId).not.toBe(req.deviceId);
  });

  it("refuses a key that is already enrolled", async () => {
    const { identity } = await enrolled();
    await expect(requestEnrollment({ publicKey: identity.publicKey, type: "door" })).rejects.toThrow(/already enrolled/);
  });

  it("rejects something that is not a P-256 public key", async () => {
    await expect(requestEnrollment({ publicKey: "bm90IGEga2V5", type: "door" })).rejects.toThrow(/P-256/);
  });

  it("caps the number of pending requests", async () => {
    const { config } = await import("../../config.js");
    const original = config.MAX_PENDING_ENROLLMENTS;
    config.MAX_PENDING_ENROLLMENTS = 2;
    try {
      await requestEnrollment({ publicKey: generateIdentity().publicKey, type: "door" });
      await requestEnrollment({ publicKey: generateIdentity().publicKey, type: "door" });
      await expect(requestEnrollment({ publicKey: generateIdentity().publicKey, type: "door" })).rejects.toThrow(/Too many pending/);
    } finally {
      config.MAX_PENDING_ENROLLMENTS = original;
    }
  });

  it("tells consoles when a request arrives and when it is resolved", async () => {
    const seen: string[] = [];
    const onReq = (r: { id: string; fingerprint: string }) => seen.push(`requested:${r.id}`);
    const onRes = (e: { deviceId: string; outcome: string }) => seen.push(`${e.outcome}:${e.deviceId}`);
    consoleBus.on("enrollment.requested", onReq);
    consoleBus.on("enrollment.resolved", onRes);
    try {
      const a = await requestEnrollment({ publicKey: generateIdentity().publicKey, type: "door" });
      const b = await requestEnrollment({ publicKey: generateIdentity().publicKey, type: "display" });
      await approveRequest(a.deviceId, {});
      await denyRequest(b.deviceId);
      expect(seen).toEqual([`requested:${a.deviceId}`, `requested:${b.deviceId}`, `approved:${a.deviceId}`, `denied:${b.deviceId}`]);
    } finally {
      consoleBus.off("enrollment.requested", onReq);
      consoleBus.off("enrollment.resolved", onRes);
    }
  });
});

describe("handshake over the gateway", () => {
  it("authenticates an enrolled device and sends the desired state first", async () => {
    const { identity, deviceId } = await enrolled();
    const dev = connect(deviceId, identity);
    await dev.ready;
    const ready = await dev.next("session.ready");
    expect(ready.payload.pendingCommands).toBe(0);
    expect(registry.isOnline(deviceId)).toBe(true);
    dev.close();
    await dev.closed;
  });

  it.each([
    ["a pending (not approved) device", async () => {
      const identity = generateIdentity();
      const req = await requestEnrollment({ publicKey: identity.publicKey, type: "door" });
      return { identity, deviceId: req.deviceId };
    }],
    ["an unknown device id", async () => ({ identity: generateIdentity(), deviceId: ulid() })],
    ["a device signing with the wrong key", async () => {
      const { deviceId } = await enrolled();
      return { identity: generateIdentity(), deviceId };
    }],
    ["a revoked device", async () => {
      const { identity, deviceId } = await enrolled();
      await revokeDevice(deviceId);
      return { identity, deviceId };
    }],
  ])("refuses %s with the same close code", async (_name, make) => {
    const { identity, deviceId } = await make();
    const dev = connect(deviceId, identity);
    expect(await dev.closed).toBe(CloseCode.AuthFailed);
  });

  it("device aborts when the gateway does not own the provisioned server key", async () => {
    const { identity, deviceId } = await enrolled();
    const dev = new TestDevice(url, deviceId, identity.privateKey, generateIdentity().publicKey);
    await dev.closed;
    expect(dev.handshakeError?.message).toMatch(/server signature invalid/);
    expect(registry.isOnline(deviceId)).toBe(false);
  });

  it("closes sockets that never complete the handshake", async () => {
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`${url}/ws/device`);
    const code = await new Promise<number>((resolve) => ws.on("close", resolve));
    expect(code).toBe(CloseCode.HandshakeTimeout);
  });

  it("rejects garbage instead of the hello", async () => {
    const dev = connect(ulid(), generateIdentity());
    dev.ws.removeAllListeners("open");
    dev.ws.on("open", () => dev.sendRaw("not json", false));
    expect(await dev.closed).toBe(CloseCode.ProtocolError);
  });
});

describe("live connection", () => {
  it("delivers a command, and the ack marks it acked", async () => {
    const { identity, deviceId } = await enrolled();
    const dev = connect(deviceId, identity);
    await dev.ready;
    await dev.next("session.ready");

    await enqueueCommand(deviceId, "room.status.set", occupied);
    const cmd = await dev.next("room.status.set");
    expect(cmd.payload).toEqual(occupied);

    dev.send("ack", { ref: cmd.id });
    await new Promise((r) => setTimeout(r, 150));
    expect((await CommandModel.findOne({ commandId: cmd.id }))?.status).toBe("acked");
    dev.close();
  });

  it("replays unacknowledged commands on reconnect, with the same id, and never an acked one", async () => {
    const { identity, deviceId } = await enrolled();
    await enqueueCommand(deviceId, "announce.show", { announcementId: "a1", text: "Fire drill at 10:00", priority: "urgent" });
    await enqueueCommand(deviceId, "room.status.set", { ...occupied, status: "closed", label: "Closed" });

    const first = connect(deviceId, identity);
    await first.ready;
    const ready1 = await first.next("session.ready");
    expect(ready1.payload.pendingCommands).toBe(2);
    const a1 = await first.next("announce.show");
    const r1 = await first.next("room.status.set");
    first.send("ack", { ref: a1.id }); // only the first is acknowledged
    await new Promise((r) => setTimeout(r, 150));
    first.close();
    await first.closed;

    const second = connect(deviceId, identity);
    await second.ready;
    const ready2 = await second.next("session.ready");
    expect(ready2.payload.pendingCommands).toBe(1);
    const again = await second.next("room.status.set");
    expect(again.id).toBe(r1.id); // same id: the device can deduplicate
    expect(second.inbox.find((m) => m.type === "announce.show")).toBeUndefined();
    second.close();
  });

  it("does not resend expired commands", async () => {
    const { identity, deviceId } = await enrolled();
    const cmd = await enqueueCommand(deviceId, "room.status.set", { ...occupied, status: "free" });
    await CommandModel.updateOne({ commandId: cmd.commandId }, { expiresAt: new Date(Date.now() - 1000) });
    const dev = connect(deviceId, identity);
    await dev.ready;
    expect((await dev.next("session.ready")).payload.pendingCommands).toBe(0);
    dev.close();
  });

  it("room status commands update the desired state, which is sent on connection", async () => {
    const { identity, deviceId } = await enrolled();
    await enqueueCommand(deviceId, "room.status.set", { ...occupied, status: "reserved", label: "Reserved" });
    const dev = connect(deviceId, identity);
    await dev.ready;
    const ready = await dev.next("session.ready");
    expect(ready.payload.desired).toMatchObject({ roomStatus: { ...occupied, status: "reserved", label: "Reserved" } });
    dev.close();
  });

  it("stores state reports as the reported state", async () => {
    const { identity, deviceId } = await enrolled();
    const dev = connect(deviceId, identity);
    await dev.ready;
    dev.send("state.report", { state: { roomStatus: "occupied" }, telemetry: { battery: 87 } });
    await new Promise((r) => setTimeout(r, 150));
    const doc = await DeviceModel.findOne({ deviceId });
    expect(doc?.reported).toEqual({ roomStatus: "occupied" });
    expect(doc?.telemetry).toEqual({ battery: 87 });
    dev.close();
  });

  it("rejects invalid commands before they reach the outbox", async () => {
    const { deviceId } = await enrolled();
    await expect(enqueueCommand(deviceId, "room.status.set", { ...occupied, status: "Not A Key" })).rejects.toThrow();
    await expect(enqueueCommand(deviceId, "self.destruct", {})).rejects.toThrow(/Unknown command/);
    expect(await CommandModel.countDocuments()).toBe(0);
  });

  it("replaces an older connection of the same device", async () => {
    const { identity, deviceId } = await enrolled();
    const a = connect(deviceId, identity);
    await a.ready;
    const b = connect(deviceId, identity);
    await b.ready;
    expect(await a.closed).toBe(CloseCode.Replaced);
    expect(registry.isOnline(deviceId)).toBe(true); // the old socket closing did not unregister the new one
    b.close();
    await b.closed;
  });

  it("closes the socket immediately when the device is revoked", async () => {
    const { identity, deviceId } = await enrolled();
    const dev = connect(deviceId, identity);
    await dev.ready;
    await revokeDevice(deviceId);
    expect(await dev.closed).toBe(CloseCode.Revoked);
    const again = connect(deviceId, identity);
    expect(await again.closed).toBe(CloseCode.AuthFailed);
  });

  it("marks a device offline after missed pongs", async () => {
    const { identity, deviceId } = await enrolled();
    const dev = connect(deviceId, identity, { autoPong: false });
    await dev.ready;
    expect(await dev.closed).toBe(CloseCode.PingTimeout);
    await new Promise((r) => setTimeout(r, 50));
    expect(registry.isOnline(deviceId)).toBe(false);
  });

  it("keeps a device that answers pings", async () => {
    const { identity, deviceId } = await enrolled();
    const dev = connect(deviceId, identity);
    await dev.ready;
    await new Promise((r) => setTimeout(r, 400)); // several ping intervals
    expect(dev.closeCode).toBeNull();
    dev.close();
  });
});

describe("hostile input after authentication", () => {
  async function liveDevice() {
    const { identity, deviceId } = await enrolled();
    const dev = connect(deviceId, identity);
    await dev.ready;
    return dev;
  }

  it("closes on a plaintext frame", async () => {
    const dev = await liveDevice();
    dev.sendRaw(JSON.stringify({ v: 1 }), false);
    expect(await dev.closed).toBe(CloseCode.ProtocolError);
  });

  it("closes on a tampered ciphertext", async () => {
    const dev = await liveDevice();
    const frame = dev.encrypt(JSON.stringify({ hello: "world" }));
    frame[12] ^= 0xff;
    dev.sendRaw(frame);
    expect(await dev.closed).toBe(CloseCode.ProtocolError);
  });

  it("closes on a replayed encrypted frame", async () => {
    const dev = await liveDevice();
    const frame = dev.encrypt(JSON.stringify({}));
    dev.sendRaw(frame);
    dev.sendRaw(frame);
    expect(await dev.closed).toBe(CloseCode.ProtocolError);
  });

  it("closes on an authentic frame with an invalid message", async () => {
    const dev = await liveDevice();
    dev.sendRaw(dev.encrypt(JSON.stringify({ v: 1, type: "room.status.set", id: ulid(), ts: 1, seq: 1, payload: {} })));
    expect(await dev.closed).toBe(CloseCode.ProtocolError);
  });

  it("closes on a wrong sequence number", async () => {
    const dev = await liveDevice();
    dev.send("state.report", { state: {} }, 5); // expected 1
    expect(await dev.closed).toBe(CloseCode.ProtocolError);
  });

  it("closes on an oversized frame", async () => {
    const dev = await liveDevice();
    dev.sendRaw(Buffer.alloc(200_000, 1));
    expect(await dev.closed).toBe(1009); // ws: message too big
  });

  it("cannot acknowledge another device's command", async () => {
    const a = await enrolled();
    const b = await enrolled();
    const cmd = await enqueueCommand(a.deviceId, "room.status.set", { ...occupied, status: "free" });
    const devB = connect(b.deviceId, b.identity);
    await devB.ready;
    devB.send("ack", { ref: cmd.commandId });
    await new Promise((r) => setTimeout(r, 150));
    expect((await CommandModel.findOne({ commandId: cmd.commandId }))?.status).toBe("pending");
    devB.close();
  });
});

describe("admin channel", () => {
  it("refuses an unauthenticated console socket", async () => {
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`${url}/ws/admin`);
    const err = await new Promise<Error>((resolve) => ws.on("error", resolve));
    expect(err.message).toMatch(/401/);
  });

  it("refuses unknown paths", async () => {
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`${url}/ws/nope`);
    const err = await new Promise<Error>((resolve) => ws.on("error", resolve));
    expect(err.message).toMatch(/404/);
  });
});
