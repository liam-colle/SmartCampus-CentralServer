import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type ApiClient, type Harness } from "../../testing/harness.js";
import { AuditLogModel } from "../../models/auditLog.js";
import { BuildingModel } from "../../models/building.js";
import { CommandModel } from "../../models/command.js";
import { DeviceModel } from "../../models/device.js";
import { RoomModel } from "../../models/room.js";
import { RoomStatusChangeModel } from "../../models/roomStatusChange.js";
import { RoomStatusModel } from "../../models/roomStatus.js";

let h: Harness;
let admin: ApiClient;
let operator: ApiClient;
let staff: ApiClient;
let roomId: string;

beforeAll(async () => {
  h = await startHarness();
  [admin, operator, staff] = await Promise.all([h.login("admin"), h.login("operator"), h.login("staff")]);
}, 120_000);
afterAll(() => h.stop());

beforeEach(async () => {
  await Promise.all([
    DeviceModel.deleteMany({}),
    CommandModel.deleteMany({}),
    RoomModel.deleteMany({}),
    BuildingModel.deleteMany({}),
    RoomStatusChangeModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    RoomStatusModel.deleteMany({ builtIn: false }),
  ]);
  const building = await BuildingModel.create({ code: "B2", name: "Building 2" });
  roomId = String((await RoomModel.create({ building: building._id, code: "B2-104", name: "Lab", floor: 1, capacity: 24 }))._id);
});

describe("room status", () => {
  it("rooms start free and list their status", async () => {
    const { body } = await staff.request("GET", `/rooms/${roomId}`);
    expect(body.status).toBe("free");
  });

  it("changes the status, records history and an audit entry", async () => {
    const res = await operator.request("PUT", `/rooms/${roomId}/status`, { status: "occupied" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("occupied");

    const history = (await staff.request("GET", `/rooms/${roomId}/status-history`)).body.items;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: "free", to: "occupied", label: "Occupied", by: "Test operator" });
    expect(await AuditLogModel.countDocuments({ action: "room.status.set", targetId: roomId })).toBe(1);
  });

  it("setting the same status again changes nothing", async () => {
    await operator.request("PUT", `/rooms/${roomId}/status`, { status: "closed" });
    await operator.request("PUT", `/rooms/${roomId}/status`, { status: "closed" });
    expect(await RoomStatusChangeModel.countDocuments()).toBe(1);
  });

  it("refuses an unknown status and staff accounts", async () => {
    expect((await operator.request("PUT", `/rooms/${roomId}/status`, { status: "exploded" })).status).toBe(400);
    expect((await staff.request("PUT", `/rooms/${roomId}/status`, { status: "closed" })).status).toBe(403);
    expect((await h.anonymous.request("PUT", `/rooms/${roomId}/status`, { status: "closed" })).status).toBe(401);
  });

  it("reaches an online door screen and is replayed to an offline one", async () => {
    const { identity, deviceId } = await h.enrollDevice({ room: roomId });
    const online = h.connectDevice(deviceId, identity);
    await online.ready;
    await online.next("session.ready");
    await online.next("room.info.set"); // sent when the device was linked to the room
    expect((await online.next("room.status.set")).payload.status).toBe("free");

    await operator.request("PUT", `/rooms/${roomId}/status`, { status: "maintenance" });
    const status = await online.next("room.status.set");
    expect(status.payload).toMatchObject({ roomId, status: "maintenance", label: "Works", icon: "wrench" });
    online.close();
    await online.closed;

    await operator.request("PUT", `/rooms/${roomId}/status`, { status: "closed" });
    const later = h.connectDevice(deviceId, identity);
    await later.ready;
    const ready = await later.next("session.ready");
    expect(ready.payload.desired).toMatchObject({ roomStatus: { status: "closed" } });
    expect((await later.next("room.status.set")).payload.status).toBe("closed");
    later.close();
  });

  it("an offline device only gets the newest status, older ones are superseded", async () => {
    const { deviceId } = await h.enrollDevice({ room: roomId });
    await CommandModel.deleteMany({});
    for (const status of ["occupied", "closed", "free", "closed"]) {
      await operator.request("PUT", `/rooms/${roomId}/status`, { status });
    }
    const commands = await CommandModel.find({ deviceId, type: "room.status.set" }).sort({ commandId: 1 });
    expect(commands.map((c) => c.status)).toEqual(["superseded", "superseded", "superseded", "pending"]);
  });

  it("sends the room info when a device is linked to a room", async () => {
    const { deviceId } = await h.enrollDevice({ room: roomId });
    const info = await CommandModel.findOne({ deviceId, type: "room.info.set" });
    expect(info?.payload).toMatchObject({ roomId, code: "B2-104", name: "Lab", building: "Building 2", floor: 1, capacity: 24 });
  });
});

describe("custom statuses", () => {
  const exam = { key: "exam", label: "Exam in progress", color: "#7c3aed", icon: "book" };

  it("operators create, edit and delete one; everyone signed in can read", async () => {
    expect((await operator.request("POST", "/room-statuses", exam)).status).toBe(201);
    const list = (await staff.request("GET", "/room-statuses")).body.items;
    expect(list.map((s: { key: string }) => s.key)).toEqual(expect.arrayContaining(["free", "occupied", "closed", "maintenance", "exam"]));

    const edited = await operator.request("PATCH", "/room-statuses/exam", { label: "Exam" });
    expect(edited.body.label).toBe("Exam");
    expect((await operator.request("DELETE", "/room-statuses/exam")).status).toBe(204);
  });

  it("staff cannot write, and invalid colours or keys are refused", async () => {
    expect((await staff.request("POST", "/room-statuses", exam)).status).toBe(403);
    expect((await operator.request("POST", "/room-statuses", { ...exam, color: "purple" })).status).toBe(400);
    expect((await operator.request("POST", "/room-statuses", { ...exam, key: "Has Spaces" })).status).toBe(400);
    expect((await operator.request("POST", "/room-statuses", { ...exam, icon: "skull" })).status).toBe(400);
  });

  it("built-in statuses and statuses in use cannot be deleted", async () => {
    expect((await admin.request("DELETE", "/room-statuses/free")).status).toBe(409);
    await operator.request("POST", "/room-statuses", exam);
    await operator.request("PUT", `/rooms/${roomId}/status`, { status: "exam" });
    expect((await operator.request("DELETE", "/room-statuses/exam")).status).toBe(409);
  });

  it("editing a status updates the door screens that show it", async () => {
    const { identity, deviceId } = await h.enrollDevice({ room: roomId });
    await operator.request("POST", "/room-statuses", exam);
    await operator.request("PUT", `/rooms/${roomId}/status`, { status: "exam" });

    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    await dev.next("session.ready");
    await dev.next("room.status.set"); // replayed state, newest only

    await operator.request("PATCH", "/room-statuses/exam", { color: "#112233" });
    expect((await dev.next("room.status.set")).payload).toMatchObject({ status: "exam", color: "#112233" });
    dev.close();
  });

  it("history keeps the label and colour a status had at the time", async () => {
    await operator.request("POST", "/room-statuses", exam);
    await operator.request("PUT", `/rooms/${roomId}/status`, { status: "exam" });
    await operator.request("PATCH", "/room-statuses/exam", { label: "Renamed" });
    const [entry] = (await staff.request("GET", `/rooms/${roomId}/status-history`)).body.items;
    expect(entry.label).toBe("Exam in progress");
  });
});

it("leaves the mongoose connection usable for other suites", () => {
  expect(mongoose.connection.readyState).toBe(1);
});
