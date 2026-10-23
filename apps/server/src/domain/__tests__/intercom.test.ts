import { createHash } from "node:crypto";
import { signRequest } from "@smartcampus/handshake";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type ApiClient, type Harness } from "../../testing/harness.js";
import { AnnouncementModel } from "../../models/announcement.js";
import { AssetModel } from "../../models/asset.js";
import { AuditLogModel } from "../../models/auditLog.js";
import { BuildingModel } from "../../models/building.js";
import { CommandModel } from "../../models/command.js";
import { DeviceModel } from "../../models/device.js";
import { RoomModel } from "../../models/room.js";

let h: Harness;
let operator: ApiClient;
let staff: ApiClient;

/** A tiny but valid WAV header followed by silence. */
const wav = Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), Buffer.alloc(64)]);

beforeAll(async () => {
  h = await startHarness();
  [operator, staff] = await Promise.all([h.login("operator"), h.login("staff")]);
}, 120_000);
afterAll(() => h.stop());

beforeEach(async () => {
  await Promise.all([
    DeviceModel.deleteMany({}),
    CommandModel.deleteMany({}),
    AnnouncementModel.deleteMany({}),
    AssetModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    RoomModel.deleteMany({}),
    BuildingModel.deleteMany({}),
  ]);
});

const upload = (client: ApiClient, data: Buffer, name = "Bell") =>
  client.raw("POST", `/assets?name=${encodeURIComponent(name)}`, { body: data, headers: { "content-type": "audio/wav" } });

describe("assets", () => {
  it("stores audio with its hash and size, and serves it back to the console", async () => {
    const res = await upload(operator, wav);
    expect(res.status).toBe(201);
    const asset = await res.json();
    expect(asset).toMatchObject({ name: "Bell", mime: "audio/wav", size: wav.length, sha256: createHash("sha256").update(wav).digest("hex") });

    const file = await operator.raw("GET", `/assets/${asset.id}/file`);
    expect(Buffer.from(await file.arrayBuffer()).equals(wav)).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: "asset.upload" })).toBe(1);
  });

  it("refuses non audio content whatever the Content-Type says", async () => {
    expect((await upload(operator, Buffer.from("<script>alert(1)</script>".padEnd(64)))).status).toBe(415);
    expect((await upload(operator, Buffer.alloc(0))).status).toBe(400);
  });

  it("refuses an upload above the size limit", async () => {
    const tooBig = Buffer.concat([wav, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await upload(operator, tooBig)).status).toBe(413);
  });

  it("only admins and operators upload, signed-in users list, anonymous nothing", async () => {
    expect((await upload(staff, wav)).status).toBe(403);
    expect((await staff.request("GET", "/assets")).status).toBe(200);
    expect((await h.anonymous.request("GET", "/assets")).status).toBe(401);
  });
});

describe("intercom broadcast", () => {
  async function setup() {
    const asset = await (await upload(operator, wav)).json();
    const device = await h.enrollDevice();
    return { asset, ...device };
  }

  it("sends audio.play with the hash and size to the targets, as a short lived command", async () => {
    const { asset, deviceId, identity } = await setup();
    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    await dev.next("session.ready");

    const res = await operator.request("POST", "/intercom/broadcasts", { assetId: asset.id, title: "Bell", targets: { devices: [deviceId] } });
    expect(res.status).toBe(201);
    const msg = await dev.next("audio.play");
    expect(msg.payload).toMatchObject({ assetId: asset.id, sha256: asset.sha256, size: wav.length, title: "Bell" });

    const command = await CommandModel.findOne({ commandId: msg.id });
    expect(command!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    expect(await AuditLogModel.countDocuments({ action: "intercom.broadcast" })).toBe(1);
    dev.close();
  });

  it("refuses unknown assets, empty targets and staff", async () => {
    const { asset, deviceId } = await setup();
    expect((await operator.request("POST", "/intercom/broadcasts", { assetId: "nope", targets: { all: true } })).status).toBe(404);
    expect((await operator.request("POST", "/intercom/broadcasts", { assetId: asset.id, targets: { groups: ["nobody"] } })).status).toBe(400);
    expect((await staff.request("POST", "/intercom/broadcasts", { assetId: asset.id, targets: { devices: [deviceId] } })).status).toBe(403);
  });

  it("targets a building and floor like announcements do", async () => {
    const asset = await (await upload(operator, wav)).json();
    const building = String((await BuildingModel.create({ code: "C", name: "C" }))._id);
    const room = String((await RoomModel.create({ building, code: "C1", floor: 3 }))._id);
    const inside = await h.enrollDevice({ room });
    await h.enrollDevice();

    const res = await operator.request("POST", "/intercom/broadcasts", { assetId: asset.id, targets: { floors: [{ building, floor: 3 }] } });
    expect(res.body.deviceCount).toBe(1);
    expect(await CommandModel.countDocuments({ type: "audio.play", deviceId: inside.deviceId })).toBe(1);
  });
});

describe("signed download", () => {
  async function setup() {
    const asset = await (await upload(operator, wav)).json();
    const device = await h.enrollDevice();
    await operator.request("POST", "/intercom/broadcasts", { assetId: asset.id, targets: { devices: [device.deviceId] } });
    return { asset, ...device };
  }
  const path = (id: string) => `/api/assets/${id}/download`;
  const get = (id: string, deviceId: string, signed: ReturnType<typeof signRequest>) =>
    fetch(`${h.origin}${path(id)}`, {
      headers: { "x-device-id": deviceId, "x-timestamp": signed.timestamp, "x-signature": signed.signature },
    });

  it("serves the file to the device it was sent to, with the hash in a header", async () => {
    const { asset, deviceId, identity } = await setup();
    const res = await get(asset.id, deviceId, signRequest(identity.privateKey, "GET", path(asset.id)));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-sha256")).toBe(asset.sha256);
    expect(Buffer.from(await res.arrayBuffer()).equals(wav)).toBe(true);
  });

  it("refuses unsigned requests, another key, a stale timestamp and a signature for another path", async () => {
    const { asset, deviceId, identity } = await setup();
    const other = await h.enrollDevice();
    const unsigned = await fetch(`${h.origin}${path(asset.id)}`);
    expect(unsigned.status).toBe(401);
    expect((await get(asset.id, deviceId, signRequest(other.identity.privateKey, "GET", path(asset.id)))).status).toBe(401);
    expect((await get(asset.id, deviceId, signRequest(identity.privateKey, "GET", path(asset.id), Date.now() - 120_000))).status).toBe(401);
    expect((await get(asset.id, deviceId, signRequest(identity.privateKey, "GET", path("OTHER")))).status).toBe(401);
  });

  it("does not serve an asset the device was never told to play", async () => {
    const { asset } = await setup();
    const stranger = await h.enrollDevice();
    const res = await get(asset.id, stranger.deviceId, signRequest(stranger.identity.privateKey, "GET", path(asset.id)));
    expect(res.status).toBe(404);
  });

  it("refuses a revoked device", async () => {
    const { asset, deviceId, identity } = await setup();
    await (await h.login("admin")).request("POST", `/devices/${deviceId}/revoke`);
    expect((await get(asset.id, deviceId, signRequest(identity.privateKey, "GET", path(asset.id)))).status).toBe(401);
  });
});

describe("audio settings", () => {
  it("stores volume and quiet hours in the desired state and validates them", async () => {
    const { deviceId, identity } = await h.enrollDevice();
    const settings = { volume: 40, quietHours: { enabled: true, from: "20:00", to: "07:00" } };
    expect((await operator.request("PUT", `/devices/${deviceId}/audio-settings`, settings)).status).toBe(200);

    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    const ready = await dev.next("session.ready");
    expect(ready.payload.desired).toMatchObject({ audioSettings: settings });
    expect((await dev.next("audio.settings.set")).payload).toEqual(settings);
    dev.close();

    expect((await operator.request("PUT", `/devices/${deviceId}/audio-settings`, { ...settings, volume: 150 })).status).toBe(400);
    expect((await operator.request("PUT", `/devices/${deviceId}/audio-settings`, { ...settings, quietHours: { enabled: true, from: "9pm", to: "07:00" } })).status).toBe(400);
    expect((await staff.request("PUT", `/devices/${deviceId}/audio-settings`, settings)).status).toBe(403);
  });
});
