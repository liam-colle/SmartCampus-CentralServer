import mongoose from "mongoose";
import { formatFingerprint } from "@smartcampus/handshake";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { attachGateway } from "./gateway/index.js";
import { loadServerKey } from "./infra/serverKey.js";
import { seedRoomStatuses } from "./domain/roomStatus.js";
import { DeviceModel } from "./models/device.js";
import { seedAdmin } from "./seed.js";

const serverKey = loadServerKey();
console.log(`Gateway key fingerprint: ${formatFingerprint(serverKey.fingerprint)}`);

await mongoose.connect(config.MONGO_URI);
console.log("Connected to MongoDB");
// Brings the device indexes in line with the schema (the enrollment flow changed their definition).
await DeviceModel.syncIndexes();
await seedAdmin();
await seedRoomStatuses();

const server = createApp().listen(config.PORT, () => {
  console.log(`Server listening on :${config.PORT} (${config.NODE_ENV}), device gateway on /ws/device`);
});
const gateway = attachGateway(server, {
  serverPrivateKey: serverKey.privateKey,
  maxConnectsPerMinute: config.GATEWAY_CONNECTS_PER_MINUTE,
});

async function shutdown() {
  gateway.close();
  server.close();
  await mongoose.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
