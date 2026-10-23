import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrateUsers } from "../migrate.js";
import { UserModel } from "../models/user.js";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

it("turns the stored role into a group, drops the field, and can run twice", async () => {
  const users = UserModel.collection;
  await users.insertMany([
    { email: "a@campus.test", name: "A", role: "admin", disabled: false },
    { email: "o@campus.test", name: "O", role: "operator", disabled: false },
    { email: "s@campus.test", name: "S", role: "staff", disabled: false },
  ]);

  await migrateUsers();
  await migrateUsers();

  const byEmail = Object.fromEntries((await users.find({}).toArray()).map((u) => [u.email, u]));
  expect(byEmail["a@campus.test"]).toMatchObject({ groups: ["admin"] });
  expect(byEmail["o@campus.test"]).toMatchObject({ groups: ["operator"] });
  expect(byEmail["s@campus.test"]).toMatchObject({ groups: [] });
  expect(Object.values(byEmail).some((u) => "role" in u)).toBe(false);
});

it("lets several people exist without an email once the index is rebuilt", async () => {
  await UserModel.create({ name: "No mail 1", cardUid: "AAAAAAAA", groups: ["student"] });
  await UserModel.create({ name: "No mail 2", cardUid: "BBBBBBBB", groups: ["student"] });
  expect(await UserModel.countDocuments({ email: { $exists: false } })).toBe(2);
});
