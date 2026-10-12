import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";

export interface Identity {
  /** SPKI DER, base64. Safe to share; this is what the server stores at enrollment. */
  publicKey: string;
  /** PKCS#8 DER, base64. Never leaves the device / the server. */
  privateKey: string;
}

/** New ECDSA P-256 identity key pair. */
export function generateIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

const isPem = (s: string) => s.includes("-----BEGIN");

/** Accepts PKCS#8 as base64 DER or PEM. */
export function loadPrivateKey(key: string): KeyObject {
  const k = isPem(key)
    ? createPrivateKey(key)
    : createPrivateKey({ key: Buffer.from(key, "base64"), format: "der", type: "pkcs8" });
  assertP256(k);
  return k;
}

/** Accepts SPKI as base64 DER or PEM. */
export function loadPublicKey(key: string): KeyObject {
  const k = isPem(key)
    ? createPublicKey(key)
    : createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
  assertP256(k);
  return k;
}

function assertP256(k: KeyObject) {
  if (k.asymmetricKeyType !== "ec" || k.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("identity keys must be ECDSA P-256");
  }
}

export function publicKeyOf(privateKey: string): string {
  return createPublicKey(loadPrivateKey(privateKey)).export({ type: "spki", format: "der" }).toString("base64");
}

/** SHA-256 of the SPKI DER, lowercase hex. Shown on the device at enrollment and checked by the admin. */
export function fingerprint(publicKey: string): string {
  const der = loadPublicKey(publicKey).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

/** "AB12 CD34 ..." for humans. */
export const formatFingerprint = (fp: string) => (fp.toUpperCase().match(/.{1,4}/g) ?? []).join(" ");
