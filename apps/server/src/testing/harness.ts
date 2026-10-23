import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateIdentity, publicKeyOf, type Identity } from "@smartcampus/handshake";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { hashPassword } from "../lib/password.js";
import { requestEnrollment } from "../domain/devices.js";
import { seedRoomStatuses } from "../domain/roomStatus.js";
import { attachGateway } from "../gateway/index.js";
import { UserModel, type Role } from "../models/user.js";
import { TestDevice } from "../gateway/__tests__/testDevice.js";

const PASSWORD = "correct-horse-battery";

export interface ApiClient {
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  /** Raw request, for uploads and downloads. */
  raw(method: string, path: string, init?: { body?: Buffer; headers?: Record<string, string> }): Promise<Response>;
}

/**
 * Real Express app + device gateway on a random port, backed by an in-memory MongoDB.
 * Integration tests drive it the way the console and the devices do.
 */
export async function startHarness() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await seedRoomStatuses();

  const serverKey = generateIdentity();
  const http: Server = createServer(createApp({ serverPublicKey: publicKeyOf(serverKey.privateKey) }));
  const gateway = attachGateway(http, { serverPrivateKey: serverKey.privateKey, maxConnectsPerMinute: 1000 });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  const raw = (cookie: string | null) => (method: string, path: string, init: { body?: Buffer; headers?: Record<string, string> } = {}) =>
    fetch(`${origin}/api${path}`, {
      method,
      body: init.body ? new Uint8Array(init.body) : undefined,
      headers: { ...(cookie && { cookie }), ...init.headers },
    });

  const client = (cookie: string | null): ApiClient => ({
    raw: raw(cookie),
    async request(method, path, body) {
      const res = await raw(cookie)(method, path, {
        body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
        headers: body === undefined ? {} : { "content-type": "application/json" },
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  });

  // The login endpoint is rate limited, and one session per role is all a test needs.
  const sessions = new Map<Role, Promise<ApiClient>>();
  const login = (role: Role): Promise<ApiClient> => {
    if (!sessions.has(role)) sessions.set(role, signIn(role));
    return sessions.get(role)!;
  };

  async function signIn(role: Role): Promise<ApiClient> {
    const email = `${role}@test.local`;
    const existing = await UserModel.findOne({ email });
    if (!existing) await UserModel.create({ email, name: `Test ${role}`, role, passwordHash: await hashPassword(PASSWORD) });
    const res = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`test login failed for ${role}: ${res.status}`);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    return client(cookie);
  }

  /** Real enrollment (request, then approval through the console API) and an active device with its identity key. */
  async function enrollDevice(opts: { type?: "door" | "display" | "access"; room?: string; groups?: string[] } = {}) {
    const identity = generateIdentity();
    const request = await requestEnrollment({ publicKey: identity.publicKey, type: opts.type ?? "door", name: "Test device" });
    const admin = await login("admin");
    const approved = await admin.request("POST", `/devices/requests/${request.deviceId}/approve`, {
      room: opts.room ?? null,
      groups: opts.groups ?? [],
    });
    if (approved.status !== 200) throw new Error(`approval failed: ${approved.status} ${JSON.stringify(approved.body)}`);
    return { identity, deviceId: request.deviceId };
  }

  const connectDevice = (deviceId: string, identity: Identity) =>
    new TestDevice(origin.replace("http", "ws"), deviceId, identity.privateKey, publicKeyOf(serverKey.privateKey));

  return {
    origin,
    anonymous: client(null),
    login,
    enrollDevice,
    connectDevice,
    async stop() {
      gateway.close();
      http.close();
      await mongoose.disconnect();
      await mongo.stop();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;
