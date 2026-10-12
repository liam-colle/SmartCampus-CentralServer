import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { fingerprint, loadPrivateKey, publicKeyOf } from "@smartcampus/handshake";
import { config, isProd } from "../config.js";

export interface ServerKey {
  /** PEM, kept in memory only. */
  privateKey: string;
  /** SPKI DER base64: what devices are provisioned with. */
  publicKey: string;
  fingerprint: string;
}

export function writeNewKey(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Loads the gateway identity key from SERVER_KEY_FILE. Never reads it from the repo or an API. */
export function loadServerKey(): ServerKey {
  const file = resolve(config.SERVER_KEY_FILE);
  if (!existsSync(file)) {
    if (isProd) {
      throw new Error(`Server key not found at ${file}. Generate it with the keys:generate script and mount it as a secret.`);
    }
    writeNewKey(file);
    console.log(`Generated development server key at ${file}`);
  }
  const privateKey = readFileSync(file, "utf8");
  loadPrivateKey(privateKey); // fails fast on a wrong curve or a corrupt file
  const publicKey = publicKeyOf(privateKey);

  // Convenience copy of the public half, to provision devices and the simulator.
  writeFileSync(`${file.replace(/\.pem$/, "")}.pub`, `${publicKey}\n`);
  return { privateKey, publicKey, fingerprint: fingerprint(publicKey) };
}
