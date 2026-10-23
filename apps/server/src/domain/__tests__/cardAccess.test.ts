import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type ApiClient, type Harness } from "../../testing/harness.js";
import { AuditLogModel } from "../../models/auditLog.js";
import { CommandModel } from "../../models/command.js";
import { BuildingModel } from "../../models/building.js";
import { DeviceModel } from "../../models/device.js";
import { RoomModel } from "../../models/room.js";
import { RegistrationSessionModel } from "../../models/registrationSession.js";
import { UserModel } from "../../models/user.js";
import type { TestDevice } from "../../gateway/__tests__/testDevice.js";

let h: Harness;
let admin: ApiClient;
let operator: ApiClient;
let staff: ApiClient;

beforeAll(async () => {
  h = await startHarness();
  [admin, operator, staff] = await Promise.all([h.login("admin"), h.login("operator"), h.login("staff")]);
}, 120_000);
afterAll(() => h.stop());

beforeEach(async () => {
  await Promise.all([
    DeviceModel.deleteMany({}),
    CommandModel.deleteMany({}),
    RegistrationSessionModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    UserModel.deleteMany({ cardUid: { $exists: true } }),
  ]);
});

const CARD_A = "04A22B1C";
const CARD_B = "04:B3:3C:2D";
const CARD_C = "0411223344556677";

/** An online reader and a function that presents a card to it and returns the server's answer. */
async function reader(type: "access" | "door" | "display" = "access") {
  const { identity, deviceId } = await h.enrollDevice({ type });
  const dev: TestDevice = h.connectDevice(deviceId, identity);
  await dev.ready;
  await dev.next("session.ready");
  const present = async (badgeUid: string) => {
    const sent = dev.send("event.badge", { badgeUid, at: Date.now() });
    const answer = await dev.next("card.result");
    expect(answer.payload.ref).toBe(sent.id);
    return answer.payload;
  };
  return { dev, deviceId, present };
}

const createStudent = (client: ApiClient, name: string, cardUid: string) => client.request("POST", "/students", { name, cardUid });

describe("maintenance menu", () => {
  it("opens for an administrator's card, whatever the notation of the serial number", async () => {
    await admin.request("POST", "/users", { name: "Ada Admin", email: "ada@campus.test", password: "correct-horse-battery", groups: ["admin"], cardUid: CARD_A });
    const { dev, present } = await reader();

    expect(await present("04:a2:2b:1c")).toMatchObject({ outcome: "maintenance", maintenance: true, name: "Ada Admin" });
    expect(await AuditLogModel.countDocuments({ action: "maintenance.open", actorName: "Ada Admin" })).toBe(1);
    dev.close();
  });

  it("opens for a student who was also made an operator", async () => {
    const student = await createStudent(admin, "Sam Student", CARD_A);
    expect((await admin.request("PATCH", `/users/${student.body.id}`, { groups: ["student", "operator"] })).status).toBe(200);
    const { dev, present } = await reader();

    expect(await present(CARD_A)).toMatchObject({ outcome: "maintenance", maintenance: true });
    dev.close();
  });

  it("stays shut for a plain student, an unknown card and a disabled administrator", async () => {
    await createStudent(admin, "Sam Student", CARD_A);
    const disabled = await admin.request("POST", "/users", { name: "Dan Disabled", email: "dan@campus.test", password: "correct-horse-battery", groups: ["admin"], cardUid: CARD_B });
    await admin.request("POST", "/users", { name: "Other Admin", email: "other@campus.test", password: "correct-horse-battery", groups: ["admin"] });
    await admin.request("PATCH", `/users/${disabled.body.id}`, { disabled: true });
    const { dev, present } = await reader();

    expect(await present(CARD_A)).toMatchObject({ outcome: "recognised", maintenance: false, name: "Sam Student" });
    expect(await present(CARD_C)).toMatchObject({ outcome: "unknown", maintenance: false });
    expect(await present(CARD_B)).toMatchObject({ outcome: "disabled", maintenance: false });
    expect(await present("not-a-card")).toMatchObject({ outcome: "unknown", maintenance: false });
    dev.close();
  });

  it("closes again when the person leaves the privileged groups", async () => {
    const user = await admin.request("POST", "/users", { name: "Olga Operator", email: "olga@campus.test", password: "correct-horse-battery", groups: ["operator"], cardUid: CARD_A });
    const { dev, present } = await reader();
    expect((await present(CARD_A)).maintenance).toBe(true);

    await admin.request("PATCH", `/users/${user.body.id}`, { groups: ["student"] });
    expect(await present(CARD_A)).toMatchObject({ outcome: "recognised", maintenance: false });
    dev.close();
  });

  it("tells a reader that presents too many cards to slow down", async () => {
    const { dev, present } = await reader();
    for (let i = 0; i < 30; i++) await present(CARD_C);
    expect(await present(CARD_C)).toMatchObject({ outcome: "rate_limited", maintenance: false });
    dev.close();
  });
});

describe("groups and permissions", () => {
  it("an operator manages students but cannot grant operator or administrator", async () => {
    const student = await createStudent(operator, "Sam Student", CARD_A);
    expect(student.status).toBe(201);
    expect(student.body.groups).toEqual(["student"]);

    expect((await operator.request("PATCH", `/users/${student.body.id}`, { groups: ["student", "operator"] })).status).toBe(403);
    expect((await operator.request("POST", "/users", { name: "X", email: "x@campus.test", password: "correct-horse-battery", groups: ["admin"] })).status).toBe(403);
  });

  it("an operator cannot touch an administrator, even one who is also a student", async () => {
    const boss = await admin.request("POST", "/users", { name: "Boss", email: "boss@campus.test", password: "correct-horse-battery", groups: ["admin", "student"], cardUid: CARD_A });
    expect((await operator.request("PATCH", `/users/${boss.body.id}`, { cardUid: CARD_B })).status).toBe(403);
  });

  it("staff cannot create students or start a registration", async () => {
    expect((await createStudent(staff, "Sam", CARD_A)).status).toBe(403);
    const { deviceId, dev } = await reader();
    expect((await staff.request("POST", "/card-registration", { deviceId })).status).toBe(403);
    dev.close();
  });

  it("the last active administrator cannot lose the group", async () => {
    await UserModel.deleteMany({ email: { $ne: "admin@test.local" }, groups: "admin" });
    const me = await UserModel.findOne({ email: "admin@test.local" });
    const res = await admin.request("PATCH", `/users/${me!.id}`, { groups: ["student"] });
    expect(res.status).toBe(409);
  });

  it("a card belongs to one person only, and can be removed", async () => {
    const first = await createStudent(admin, "First", CARD_A);
    const clash = await createStudent(admin, "Second", "04:a2:2b:1c");
    expect(clash.status).toBe(409);
    expect(clash.body.error).toContain("First");

    const removed = await admin.request("PATCH", `/users/${first.body.id}`, { cardUid: null });
    expect(removed.body.cardUid).toBeNull();
    expect((await createStudent(admin, "Second", CARD_A)).status).toBe(201);
  });

  it("rejects a malformed card serial number", async () => {
    expect((await createStudent(admin, "Sam", "12345")).status).toBe(400);
  });

  it("never writes a card number to the audit log", async () => {
    await createStudent(admin, "Sam Student", CARD_A);
    await admin.request("POST", "/users", { name: "Eve", email: "eve@campus.test", password: "correct-horse-battery", groups: ["operator"], cardUid: CARD_B });
    const logs = JSON.stringify(await AuditLogModel.find({}).lean());
    expect(logs).not.toContain("04A22B1C");
    expect(logs).not.toContain("04B33C2D");
  });
});

describe("identity registration mode", () => {
  it("collects cards from the chosen reader until stopped, then enrols them as students", async () => {
    const { dev, deviceId, present } = await reader();
    const start = await operator.request("POST", "/card-registration", { deviceId });
    expect(start.status).toBe(201);

    const mode = await dev.next("registration.mode.set");
    expect(mode.payload).toMatchObject({ sessionId: start.body.id, active: true });
    expect(mode.payload.expiresAt).toBeGreaterThan(Date.now());

    expect(await present(CARD_A)).toMatchObject({ outcome: "captured", maintenance: false });
    expect(await present("04-b3-3c-2d")).toMatchObject({ outcome: "captured" });
    expect(await present(CARD_A)).toMatchObject({ outcome: "duplicate" });

    const live = await operator.request("GET", `/card-registration/${start.body.id}`);
    expect(live.body.cards.map((c: { cardUid: string }) => c.cardUid)).toEqual(["04A22B1C", "04B33C2D"]);

    const stop = await operator.request("DELETE", `/card-registration/${start.body.id}`);
    expect(stop.body.status).toBe("closed");
    expect((await dev.next("registration.mode.set")).payload.active).toBe(false);

    const bulk = await operator.request("POST", "/students/bulk", {
      students: [
        { name: "Alice", cardUid: "04A22B1C" },
        { name: "Bob", cardUid: "04B33C2D" },
        { name: "Mallory", cardUid: "04A22B1C" },
      ],
    });
    expect(bulk.status).toBe(201);
    expect(bulk.body.created.map((s: { name: string }) => s.name)).toEqual(["Alice", "Bob"]);
    expect(bulk.body.errors).toEqual([{ index: 2, message: "This card already belongs to Alice" }]);
    dev.close();
  });

  it("does not open the maintenance menu while collecting, even for an administrator's card", async () => {
    await admin.request("POST", "/users", { name: "Ada Admin", email: "ada@campus.test", password: "correct-horse-battery", groups: ["admin"], cardUid: CARD_A });
    const { dev, deviceId, present } = await reader();
    await operator.request("POST", "/card-registration", { deviceId });

    expect(await present(CARD_A)).toMatchObject({ outcome: "already_registered", maintenance: false });
    dev.close();
  });

  it("goes back to normal once the session is stopped", async () => {
    await admin.request("POST", "/users", { name: "Ada Admin", email: "ada@campus.test", password: "correct-horse-battery", groups: ["admin"], cardUid: CARD_A });
    const { dev, deviceId, present } = await reader();
    const { body } = await operator.request("POST", "/card-registration", { deviceId });
    await operator.request("DELETE", `/card-registration/${body.id}`);

    expect((await present(CARD_A)).maintenance).toBe(true);
    dev.close();
  });

  it("stops collecting after the window and a reconnecting reader is not put back in the mode", async () => {
    const { dev, deviceId, present } = await reader();
    const { body } = await operator.request("POST", "/card-registration", { deviceId });
    await RegistrationSessionModel.updateOne({ sessionId: body.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await present(CARD_C)).toMatchObject({ outcome: "unknown" });
    expect((await operator.request("GET", `/card-registration/${body.id}`)).body.status).toBe("closed");
    dev.close();
  });

  it("a new session replaces the previous one of the same reader", async () => {
    const { dev, deviceId } = await reader();
    const first = await operator.request("POST", "/card-registration", { deviceId });
    await operator.request("POST", "/card-registration", { deviceId });
    expect((await operator.request("DELETE", `/card-registration/${first.body.id}`)).status).toBe(404);
    dev.close();
  });

  it("refuses a device without a card reader and an unknown one", async () => {
    const display = await h.enrollDevice({ type: "display" });
    expect((await operator.request("POST", "/card-registration", { deviceId: display.deviceId })).status).toBe(400);
    expect((await operator.request("POST", "/card-registration", { deviceId: "nope" })).status).toBe(404);
  });
});

describe("users without an email", () => {
  it("lets several students exist without one, and refuses to mail them", async () => {
    const a = await createStudent(admin, "A", CARD_A);
    const b = await createStudent(admin, "B", CARD_B);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await admin.request("POST", `/users/${a.body.id}/invite`)).status).toBe(400);
  });
});

describe("maintenance menu actions", () => {
  const ADMIN = { name: "Ada Admin", email: "ada@campus.test", password: "correct-horse-battery", groups: ["admin"], cardUid: CARD_A };
  const OPERATOR = { name: "Olga Operator", email: "olga@campus.test", password: "correct-horse-battery", groups: ["operator"], cardUid: CARD_B };

  /** A reader linked to a room, an accepted card, and a function that sends one menu action. */
  async function menuOpenedBy(person: typeof ADMIN) {
    await RoomModel.deleteMany({});
    await BuildingModel.deleteMany({});
    const building = await BuildingModel.create({ code: "B2", name: "Building 2" });
    const room = await RoomModel.create({ building: building._id, code: "B2-104", name: "Lab", floor: 1 });
    await admin.request("POST", "/users", person);

    const { identity, deviceId } = await h.enrollDevice({ type: "access", room: String(room._id) });
    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    await dev.next("session.ready");
    const tap = dev.send("event.badge", { badgeUid: person.cardUid, at: Date.now() });
    const card = await dev.next("card.result");
    expect(card.payload.ref).toBe(tap.id);

    const act = async (action: "status.set" | "restart" | "revoke", status?: string) => {
      const sent = dev.send("maintenance.action", { action, status });
      const result = await dev.next("maintenance.result");
      expect(result.payload.ref).toBe(sent.id);
      return result.payload;
    };
    return { dev, deviceId, room, card: card.payload, act };
  }

  it("offers the statuses, and revoking only to administrators", async () => {
    const asAdmin = await menuOpenedBy(ADMIN);
    expect(asAdmin.card.menu?.canRevoke).toBe(true);
    expect(asAdmin.card.menu?.statuses.map((s) => s.key)).toEqual(expect.arrayContaining(["free", "occupied", "closed"]));
    asAdmin.dev.close();

    await UserModel.deleteMany({ cardUid: { $exists: true } });
    const asOperator = await menuOpenedBy(OPERATOR);
    expect(asOperator.card.menu?.canRevoke).toBe(false);
    asOperator.dev.close();
  });

  it("changes the status of the terminal's room, as the person whose card opened the menu", async () => {
    const { dev, room, act } = await menuOpenedBy(OPERATOR);
    expect(await act("status.set", "occupied")).toMatchObject({ ok: true });

    expect((await RoomModel.findById(room._id))?.status).toBe("occupied");
    expect(await AuditLogModel.countDocuments({ action: "room.status.set", actorName: "Olga Operator" })).toBe(1);
    // The room's current status was already queued at approval, the new one comes after it.
    const pushed = [(await dev.next("room.status.set")).payload.status, (await dev.next("room.status.set")).payload.status];
    expect(pushed).toEqual(["free", "occupied"]);
    dev.close();
  });

  it("an operator cannot revoke the terminal, an administrator can", async () => {
    const operatorMenu = await menuOpenedBy(OPERATOR);
    expect(await operatorMenu.act("revoke")).toMatchObject({ ok: false });
    expect((await DeviceModel.findOne({ deviceId: operatorMenu.deviceId }))?.status).toBe("active");
    operatorMenu.dev.close();

    await UserModel.deleteMany({ cardUid: { $exists: true } });
    const adminMenu = await menuOpenedBy(ADMIN);
    expect(await adminMenu.act("revoke")).toMatchObject({ ok: true });
    expect(await adminMenu.dev.closed).toBe(4403);
    expect((await DeviceModel.findOne({ deviceId: adminMenu.deviceId }))?.status).toBe("revoked");
    expect(await AuditLogModel.countDocuments({ action: "maintenance.revoke" })).toBe(1);
  });

  it("refuses every action without a grant, and once the person lost access", async () => {
    const { identity, deviceId } = await h.enrollDevice({ type: "access" });
    const stranger = h.connectDevice(deviceId, identity);
    await stranger.ready;
    await stranger.next("session.ready");
    stranger.send("maintenance.action", { action: "restart" });
    expect((await stranger.next("maintenance.result")).payload).toMatchObject({ ok: false });
    stranger.close();

    const { dev, act } = await menuOpenedBy(OPERATOR);
    await UserModel.updateOne({ cardUid: CARD_B.replace(/[:-]/g, "").toUpperCase() }, { $set: { disabled: true } });
    expect(await act("restart")).toMatchObject({ ok: false });
    dev.close();
  });

  it("a menu does not outlive the connection it was opened on", async () => {
    const first = await menuOpenedBy(OPERATOR);
    const { deviceId } = first;
    first.dev.close();
    await first.dev.closed;

    const identity = (await DeviceModel.findOne({ deviceId }))!;
    expect(identity.status).toBe("active");
  });

  it("a status needs a linked room, and restart is audited", async () => {
    const { identity, deviceId } = await h.enrollDevice({ type: "access" });
    await admin.request("POST", "/users", OPERATOR);
    const dev = h.connectDevice(deviceId, identity);
    await dev.ready;
    await dev.next("session.ready");
    dev.send("event.badge", { badgeUid: OPERATOR.cardUid, at: Date.now() });
    await dev.next("card.result");

    dev.send("maintenance.action", { action: "status.set", status: "occupied" });
    expect((await dev.next("maintenance.result")).payload).toMatchObject({ ok: false, error: "This terminal is not linked to a room" });
    dev.send("maintenance.action", { action: "restart" });
    expect((await dev.next("maintenance.result")).payload).toMatchObject({ ok: true });
    expect(await AuditLogModel.countDocuments({ action: "maintenance.restart" })).toBe(1);
    dev.close();
  });
});
