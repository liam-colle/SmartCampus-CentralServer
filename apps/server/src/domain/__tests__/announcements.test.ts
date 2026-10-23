import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type ApiClient, type Harness } from "../../testing/harness.js";
import { AnnouncementModel } from "../../models/announcement.js";
import { AuditLogModel } from "../../models/auditLog.js";
import { BuildingModel } from "../../models/building.js";
import { CommandModel } from "../../models/command.js";
import { DeviceModel } from "../../models/device.js";
import { RoomModel } from "../../models/room.js";

let h: Harness;
let operator: ApiClient;
let staff: ApiClient;
let buildingA: string;
let buildingB: string;
let roomA1: string;
let roomB1: string;

beforeAll(async () => {
  h = await startHarness();
  [operator, staff] = await Promise.all([h.login("operator"), h.login("staff")]);
}, 120_000);
afterAll(() => h.stop());

beforeEach(async () => {
  await Promise.all([
    DeviceModel.deleteMany({}),
    CommandModel.deleteMany({}),
    RoomModel.deleteMany({}),
    BuildingModel.deleteMany({}),
    AnnouncementModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
  ]);
  buildingA = String((await BuildingModel.create({ code: "A", name: "Building A" }))._id);
  buildingB = String((await BuildingModel.create({ code: "B", name: "Building B" }))._id);
  roomA1 = String((await RoomModel.create({ building: buildingA, code: "A1", floor: 1 }))._id);
  roomB1 = String((await RoomModel.create({ building: buildingB, code: "B1", floor: 2 }))._id);
});

const announce = (client: ApiClient, body: object) => client.request("POST", "/announcements", body);

describe("announcements", () => {
  it("reaches an online screen with its priority and expiry", async () => {
    const { identity, deviceId } = await h.enrollDevice({ room: roomA1 });
    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    await dev.next("session.ready");

    const expiresAt = new Date(Date.now() + 3_600_000);
    const res = await announce(operator, { title: "Fire drill", text: "10:00 outside", priority: "urgent", targets: { devices: [deviceId] }, expiresAt });
    expect(res.status).toBe(201);

    const msg = await dev.next("announce.show");
    expect(msg.payload).toMatchObject({ title: "Fire drill", text: "10:00 outside", priority: "urgent", expiresAt: expiresAt.getTime() });
    expect(msg.payload.announcementId).toBe(res.body.id);
    dev.close();
  });

  it("targets by building, floor and group, and not the others", async () => {
    const a = await h.enrollDevice({ room: roomA1 });
    const b = await h.enrollDevice({ room: roomB1 });
    const grouped = await h.enrollDevice({ groups: ["hall"] });

    const byBuilding = await announce(operator, { text: "x", targets: { buildings: [buildingA] } });
    expect(byBuilding.body.deviceCount).toBe(1);
    expect((await AnnouncementModel.findOne({ announcementId: byBuilding.body.id }))?.deviceIds).toEqual([a.deviceId]);

    const byFloor = await announce(operator, { text: "x", targets: { floors: [{ building: buildingB, floor: 2 }] } });
    expect((await AnnouncementModel.findOne({ announcementId: byFloor.body.id }))?.deviceIds).toEqual([b.deviceId]);

    const byGroup = await announce(operator, { text: "x", targets: { groups: ["hall"] } });
    expect((await AnnouncementModel.findOne({ announcementId: byGroup.body.id }))?.deviceIds).toEqual([grouped.deviceId]);

    expect((await announce(operator, { text: "x", targets: { all: true } })).body.deviceCount).toBe(3);
  });

  it("refuses targets that reach nobody, an empty text, a past expiry and unknown fields", async () => {
    await h.enrollDevice();
    expect((await announce(operator, { text: "x", targets: { groups: ["nobody"] } })).status).toBe(400);
    expect((await announce(operator, { text: "  ", targets: { all: true } })).status).toBe(400);
    expect((await announce(operator, { text: "x", targets: { all: true }, expiresAt: new Date(Date.now() - 1000) })).status).toBe(400);
    expect((await announce(operator, { text: "x", targets: { all: true }, priority: "emergency" })).status).toBe(400);
    expect((await announce(operator, { text: "x", targets: { all: true, admin: true } })).status).toBe(400);
  });

  it("only admins and operators write, staff read", async () => {
    await h.enrollDevice();
    expect((await announce(staff, { text: "x", targets: { all: true } })).status).toBe(403);
    expect((await h.anonymous.request("GET", "/announcements")).status).toBe(401);
    await announce(operator, { text: "visible", targets: { all: true } });
    expect((await staff.request("GET", "/announcements")).body.items).toHaveLength(1);
  });

  it("an offline screen gets it on reconnection, but not once it expired", async () => {
    const { identity, deviceId } = await h.enrollDevice();
    const { body } = await announce(operator, { text: "later", targets: { devices: [deviceId] }, expiresAt: new Date(Date.now() + 3_600_000) });

    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    const ready = await dev.next("session.ready");
    expect(Object.keys(ready.payload.desired.announcements as object)).toEqual([body.id]);
    expect((await dev.next("announce.show")).payload.text).toBe("later");
    dev.close();
    await dev.closed;

    // The announcement expired while the screen was away: the full desired state must not carry it.
    await DeviceModel.updateOne({ deviceId }, { $set: { [`desired.announcements.${body.id}.expiresAt`]: Date.now() - 1000 } });
    await CommandModel.deleteMany({});
    const later = h.connectDevice(deviceId, identity);
    await later.ready;
    const readyAgain = await later.next("session.ready");
    expect(readyAgain.payload.desired.announcements).toEqual({});
    later.close();
  });

  it("cancelling clears the screens, the twin and the unsent command", async () => {
    const { identity, deviceId } = await h.enrollDevice();
    const { body } = await announce(operator, { text: "oops", targets: { devices: [deviceId] } });
    expect((await operator.request("DELETE", `/announcements/${body.id}`)).status).toBe(204);

    expect((await CommandModel.findOne({ deviceId, type: "announce.show" }))?.status).toBe("superseded");
    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    const ready = await dev.next("session.ready");
    expect(ready.payload.desired.announcements).toEqual({});
    expect((await dev.next("announce.clear")).payload.announcementId).toBe(body.id);
    dev.close();

    expect((await operator.request("GET", `/announcements/${body.id}`)).body.state).toBe("cancelled");
    expect((await operator.request("DELETE", `/announcements/${body.id}`)).status).toBe(404);
  });

  it("writes an audit entry and reports delivery per screen", async () => {
    const { deviceId } = await h.enrollDevice();
    const { body } = await announce(operator, { text: "x", targets: { devices: [deviceId] } });
    expect(await AuditLogModel.countDocuments({ action: "announcement.create", targetId: body.id })).toBe(1);
    const detail = (await operator.request("GET", `/announcements/${body.id}`)).body;
    expect(detail.delivery).toEqual([{ deviceId, name: "Test device", delivery: "pending" }]);
  });
});
