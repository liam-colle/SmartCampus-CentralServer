import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type ApiClient, type Harness } from "../../testing/harness.js";
import { AuditLogModel } from "../../models/auditLog.js";
import { CommandModel } from "../../models/command.js";
import { DeviceModel } from "../../models/device.js";

let h: Harness;
let operator: ApiClient;
let staff: ApiClient;

beforeAll(async () => {
  h = await startHarness();
  [operator, staff] = await Promise.all([h.login("operator"), h.login("staff")]);
}, 120_000);
afterAll(() => h.stop());

beforeEach(async () => {
  await Promise.all([DeviceModel.deleteMany({}), CommandModel.deleteMany({}), AuditLogModel.deleteMany({})]);
});

const config = {
  layout: "compact",
  theme: "light",
  accentColor: "#112233",
  show: { roomName: true, building: false, floor: false, capacity: false, clock: true, announcements: true },
  sleep: { enabled: true, from: "21:30", to: "06:15" },
};

describe("display configuration", () => {
  it("returns the defaults until a configuration was set", async () => {
    const { deviceId } = await h.enrollDevice();
    const { body } = await operator.request("GET", `/devices/${deviceId}/display-config`);
    expect(body).toMatchObject({ layout: "standard", theme: "dark", accentColor: "#00a86b" });
    expect(body.sleep.enabled).toBe(false);
  });

  it("is sent to the screen, kept in its desired state and replayed after an outage", async () => {
    const { deviceId, identity } = await h.enrollDevice();
    expect((await operator.request("PUT", `/devices/${deviceId}/display-config`, config)).status).toBe(200);

    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    const ready = await dev.next("session.ready");
    expect(ready.payload.desired).toMatchObject({ displayConfig: config });
    expect((await dev.next("display.config.set")).payload.config).toEqual(config);
    dev.close();

    expect((await operator.request("GET", `/devices/${deviceId}/display-config`)).body).toEqual(config);
    expect(await AuditLogModel.countDocuments({ action: "device.display-config" })).toBe(1);
  });

  it("fills in defaults for a partial configuration", async () => {
    const { deviceId } = await h.enrollDevice();
    const { body } = await operator.request("PUT", `/devices/${deviceId}/display-config`, { layout: "split" });
    expect(body).toMatchObject({ layout: "split", theme: "dark" });
  });

  it("rejects an invalid configuration with a message and changes nothing", async () => {
    const { deviceId } = await h.enrollDevice();
    const bad = await operator.request("PUT", `/devices/${deviceId}/display-config`, { layout: "grid" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("layout");
    expect((await operator.request("PUT", `/devices/${deviceId}/display-config`, { sleep: { from: "25:61" } })).status).toBe(400);
    expect(await CommandModel.countDocuments({ type: "display.config.set" })).toBe(0);
  });

  it("is refused for staff, anonymous users, unknown devices and access units", async () => {
    const { deviceId } = await h.enrollDevice();
    const access = await h.enrollDevice({ type: "access" });
    expect((await staff.request("PUT", `/devices/${deviceId}/display-config`, config)).status).toBe(403);
    expect((await h.anonymous.request("PUT", `/devices/${deviceId}/display-config`, config)).status).toBe(401);
    expect((await operator.request("PUT", "/devices/UNKNOWN/display-config", config)).status).toBe(404);
    expect((await operator.request("PUT", `/devices/${access.deviceId}/display-config`, config)).status).toBe(400);
  });
});

describe("duplicating a configuration", () => {
  it("copies to every target and reports a failure per target without stopping", async () => {
    const source = await h.enrollDevice();
    const a = await h.enrollDevice();
    const b = await h.enrollDevice({ type: "display" });
    const access = await h.enrollDevice({ type: "access" });
    await operator.request("PUT", `/devices/${source.deviceId}/display-config`, config);

    const res = await operator.request("POST", `/devices/${source.deviceId}/display-config/copy`, {
      targetIds: [a.deviceId, b.deviceId, access.deviceId, "UNKNOWN", source.deviceId, a.deviceId],
    });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.results.map((r: { deviceId: string; ok: boolean }) => [r.deviceId, r.ok]));
    expect(byId).toEqual({ [a.deviceId]: true, [b.deviceId]: true, [access.deviceId]: false, UNKNOWN: false });

    expect((await operator.request("GET", `/devices/${a.deviceId}/display-config`)).body).toEqual(config);
    expect((await operator.request("GET", `/devices/${b.deviceId}/display-config`)).body).toEqual(config);
    expect(await AuditLogModel.countDocuments({ action: "device.display-config.copy" })).toBe(1);
  });

  it("needs targets and is closed to staff", async () => {
    const { deviceId } = await h.enrollDevice();
    expect((await operator.request("POST", `/devices/${deviceId}/display-config/copy`, { targetIds: [] })).status).toBe(400);
    expect((await staff.request("POST", `/devices/${deviceId}/display-config/copy`, { targetIds: ["x"] })).status).toBe(403);
  });
});
