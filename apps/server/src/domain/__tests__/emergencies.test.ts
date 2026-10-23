import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type ApiClient, type Harness } from "../../testing/harness.js";
import { AuditLogModel } from "../../models/auditLog.js";
import { CommandModel } from "../../models/command.js";
import { DeviceModel } from "../../models/device.js";
import { EmergencyModel } from "../../models/emergency.js";

let h: Harness;
let operator: ApiClient;
let staff: ApiClient;

beforeAll(async () => {
  h = await startHarness();
  [operator, staff] = await Promise.all([h.login("operator"), h.login("staff")]);
}, 120_000);
afterAll(() => h.stop());

beforeEach(async () => {
  await Promise.all([DeviceModel.deleteMany({}), CommandModel.deleteMany({}), EmergencyModel.deleteMany({}), AuditLogModel.deleteMany({})]);
});

const trigger = (client: ApiClient, body: object) => client.request("POST", "/emergencies", body);

describe("emergencies", () => {
  it("reaches an online screen with its wording and test settings", async () => {
    const { identity, deviceId } = await h.enrollDevice();
    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    await dev.next("session.ready");

    const res = await trigger(operator, { kind: "fire", targets: { devices: [deviceId] }, testMode: true, testVolume: 15 });
    expect(res.status).toBe(201);

    const msg = await dev.next("emergency.set");
    expect(msg.payload).toMatchObject({ emergencyId: res.body.id, kind: "fire", title: "Fire alarm", testMode: true, testVolume: 15 });
    expect(String(msg.payload.instructions).length).toBeGreaterThan(0);
    dev.close();
  });

  it("targets every screen unless told otherwise, and is real unless marked as a test", async () => {
    await h.enrollDevice();
    await h.enrollDevice();
    const res = await trigger(operator, { kind: "power" });
    expect(res.body).toMatchObject({ deviceCount: 2, testMode: false, status: "active" });
  });

  it("an offline screen sounds the alarm on reconnection, and stops once cleared", async () => {
    const { identity, deviceId } = await h.enrollDevice();
    const { body } = await trigger(operator, { kind: "seismic", targets: { devices: [deviceId] } });

    const first = h.connectDevice(deviceId, identity);
    await first.ready;
    const ready = await first.next("session.ready");
    expect((ready.payload.desired.emergency as { emergencyId: string }).emergencyId).toBe(body.id);
    first.close();
    await first.closed;

    expect((await operator.request("DELETE", `/emergencies/${body.id}`)).status).toBe(204);
    // The start was never acknowledged: the clear replaces it, so the screen does not flash an alarm that is over.
    expect((await CommandModel.findOne({ deviceId, type: "emergency.set" }))?.status).toBe("superseded");

    const second = h.connectDevice(deviceId, identity);
    await second.ready;
    const readyAgain = await second.next("session.ready");
    expect(readyAgain.payload.desired.emergency).toBeNull();
    expect((await second.next("emergency.clear")).payload.emergencyId).toBe(body.id);
    second.close();
    expect((await operator.request("DELETE", `/emergencies/${body.id}`)).status).toBe(404);
  });

  it("clearing an old alert leaves a screen that moved on to a newer one alone", async () => {
    const { deviceId } = await h.enrollDevice();
    const older = await trigger(operator, { kind: "fire", targets: { devices: [deviceId] } });
    const newer = await trigger(operator, { kind: "bomb", targets: { devices: [deviceId] } });

    await operator.request("DELETE", `/emergencies/${older.body.id}`);
    const device = await DeviceModel.findOne({ deviceId });
    expect((device?.desired as { emergency: { emergencyId: string } }).emergency.emergencyId).toBe(newer.body.id);
    expect(await CommandModel.countDocuments({ deviceId, type: "emergency.clear" })).toBe(0);
  });

  it("refuses an unknown kind, an out-of-range test volume, unknown fields and targets that reach nobody", async () => {
    await h.enrollDevice();
    expect((await trigger(operator, { kind: "zombies" })).status).toBe(400);
    expect((await trigger(operator, { kind: "fire", testVolume: 101 })).status).toBe(400);
    expect((await trigger(operator, { kind: "fire", targets: { all: true, admin: true } })).status).toBe(400);
    expect((await trigger(operator, { kind: "fire", targets: { groups: ["nobody"] } })).status).toBe(400);
  });

  it("only admins and operators trigger, staff read", async () => {
    await h.enrollDevice();
    expect((await trigger(staff, { kind: "fire" })).status).toBe(403);
    expect((await h.anonymous.request("GET", "/emergencies")).status).toBe(401);
    await trigger(operator, { kind: "fire", testMode: true });
    expect((await staff.request("GET", "/emergencies?status=active")).body.items).toHaveLength(1);
    expect((await staff.request("DELETE", "/emergencies/x")).status).toBe(403);
  });

  it("audits both ends and reports delivery and what the screen reports", async () => {
    const { deviceId } = await h.enrollDevice();
    const { body } = await trigger(operator, { kind: "biohazard", targets: { devices: [deviceId] } });
    expect(await AuditLogModel.countDocuments({ action: "emergency.trigger", targetId: body.id })).toBe(1);

    expect((await operator.request("GET", `/emergencies/${body.id}`)).body.delivery).toEqual([
      { deviceId, name: "Test device", delivery: "pending", showing: false },
    ]);
    await DeviceModel.updateOne({ deviceId }, { $set: { "reported.emergency": body.id } });
    expect((await operator.request("GET", `/emergencies/${body.id}`)).body.delivery[0].showing).toBe(true);

    await operator.request("DELETE", `/emergencies/${body.id}`);
    expect(await AuditLogModel.countDocuments({ action: "emergency.clear", targetId: body.id })).toBe(1);
  });

  it("serves the catalogue", async () => {
    const { body } = await staff.request("GET", "/emergencies/catalogue");
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(["fire", "biohazard", "nuclear", "bomb", "seismic", "power"]);
  });
});
