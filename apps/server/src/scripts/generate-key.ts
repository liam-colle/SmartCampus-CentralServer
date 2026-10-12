// Usage: pnpm --filter @smartcampus/server keys:generate [file]   (default: secrets/server-key.pem)
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fingerprint, formatFingerprint, publicKeyOf } from "@smartcampus/handshake";
import { readFileSync, writeFileSync } from "node:fs";
import { writeNewKey } from "../infra/serverKey.js";

const file = resolve(process.argv[2] ?? "secrets/server-key.pem");
if (existsSync(file)) {
  console.error(`${file} already exists, refusing to overwrite it (rotating the key means re-provisioning every device).`);
  process.exit(1);
}
writeNewKey(file);
const publicKey = publicKeyOf(readFileSync(file, "utf8"));
writeFileSync(`${file.replace(/\.pem$/, "")}.pub`, `${publicKey}\n`);
console.log(`Private key: ${file} (keep it secret, mount it, never commit it)`);
console.log(`Public key (provision on devices):\n${publicKey}`);
console.log(`Fingerprint: ${formatFingerprint(fingerprint(publicKey))}`);
