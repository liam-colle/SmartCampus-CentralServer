import mongoose from "mongoose";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { seedAdmin } from "./seed.js";

await mongoose.connect(config.MONGO_URI);
console.log("Connected to MongoDB");
await seedAdmin();

const server = createApp().listen(config.PORT, () => {
  console.log(`Server listening on :${config.PORT} (${config.NODE_ENV})`);
});

async function shutdown() {
  server.close();
  await mongoose.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
