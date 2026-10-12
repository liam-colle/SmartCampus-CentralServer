import { createECDH, createHash, hkdfSync, randomBytes, sign, verify } from "node:crypto";
import type { Auth, Challenge, Hello } from "@smartcampus/protocol";
import { PROTOCOL_VERSION } from "@smartcampus/protocol";
import { SecureChannel } from "./channel.js";
import { loadPrivateKey, loadPublicKey, publicKeyOf } from "./keys.js";

/** Any failure of the handshake. The message is for logs only; never tell the peer why. */
export class HandshakeError extends Error {}

const SERVER_CONTEXT = Buffer.from("smartcampus/v1/server\0");
const DEVICE_CONTEXT = Buffer.from("smartcampus/v1/device\0");
const SESSION_INFO = "smartcampus/v1/session";

const lp = (b: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
};

/** T = deviceId || nonceA || nonceS || ephA || ephS, each field length-prefixed (unambiguous). */
function transcript(deviceId: string, nonceA: Buffer, nonceS: Buffer, ephA: Buffer, ephS: Buffer): Buffer {
  return Buffer.concat([Buffer.from(deviceId, "utf8"), nonceA, nonceS, ephA, ephS].map(lp));
}

/** Domain-separated signatures: a device signature can never be replayed as a server signature. */
const signT = (context: Buffer, T: Buffer, privateKey: string) =>
  sign("sha256", Buffer.concat([context, T]), loadPrivateKey(privateKey));

function verifyT(context: Buffer, T: Buffer, signature: Buffer, publicKey: string): boolean {
  try {
    return verify("sha256", Buffer.concat([context, T]), loadPublicKey(publicKey), signature);
  } catch {
    return false;
  }
}

/** Session keys: HKDF-SHA256(ECDH shared secret, salt = SHA-256(T)) split in one key per direction. */
function deriveChannel(shared: Buffer, T: Buffer, role: "server" | "device"): SecureChannel {
  const okm = Buffer.from(
    hkdfSync("sha256", shared, createHash("sha256").update(T).digest(), SESSION_INFO, 64),
  );
  const c2s = okm.subarray(0, 32);
  const s2c = okm.subarray(32, 64);
  return role === "server"
    ? new SecureChannel(s2c, c2s, "s2c", "c2s")
    : new SecureChannel(c2s, s2c, "c2s", "s2c");
}

const b64 = (b: Buffer) => b.toString("base64");

/** Device side. Message flow: hello() -> (server) challenge -> onChallenge() -> auth. */
export class DeviceHandshake {
  private readonly ecdh = createECDH("prime256v1");
  private readonly nonceA = randomBytes(32);
  private ephA: Buffer | null = null;
  private done = false;

  constructor(
    private readonly opts: {
      deviceId: string;
      /** The device's own identity key (PKCS#8). */
      devicePrivateKey: string;
      /** Server public key provisioned on the device (SPKI). Not learned from the network. */
      serverPublicKey: string;
    },
  ) {}

  hello(): Hello {
    this.ephA = this.ecdh.generateKeys();
    return {
      type: "hello",
      v: PROTOCOL_VERSION,
      deviceId: this.opts.deviceId,
      nonceA: b64(this.nonceA),
      ephA: b64(this.ephA),
    };
  }

  /** Verifies the server's signature, then answers with the device's. */
  onChallenge(ch: Challenge): { auth: Auth; channel: SecureChannel } {
    if (!this.ephA || this.done) throw new HandshakeError("unexpected challenge");
    this.done = true;

    const nonceS = Buffer.from(ch.nonceS, "base64");
    const ephS = Buffer.from(ch.ephS, "base64");
    const T = transcript(this.opts.deviceId, this.nonceA, nonceS, this.ephA, ephS);

    if (!verifyT(SERVER_CONTEXT, T, Buffer.from(ch.sigS, "base64"), this.opts.serverPublicKey)) {
      throw new HandshakeError("server signature invalid");
    }
    let shared: Buffer;
    try {
      shared = this.ecdh.computeSecret(ephS);
    } catch {
      throw new HandshakeError("invalid server ephemeral key");
    }
    return {
      auth: { type: "auth", sigA: b64(signT(DEVICE_CONTEXT, T, this.opts.devicePrivateKey)) },
      channel: deriveChannel(shared, T, "device"),
    };
  }
}

/** Server side, one instance per connection. */
export class ServerHandshake {
  private readonly ecdh = createECDH("prime256v1");
  private T: Buffer | null = null;
  private ephA: Buffer | null = null;
  private helloSeen = false;
  private authSeen = false;
  deviceId: string | null = null;

  constructor(private readonly serverPrivateKey: string) {}

  /**
   * Always answers, even for unknown devices (the failure happens at onAuth, identically), so the
   * handshake does not reveal which device ids exist.
   */
  onHello(h: Hello): Challenge {
    if (this.helloSeen) throw new HandshakeError("duplicate hello");
    this.helloSeen = true;

    const nonceA = Buffer.from(h.nonceA, "base64");
    const ephA = Buffer.from(h.ephA, "base64");
    try {
      // Rejects points that are not on the curve before we do any signing.
      this.ecdh.generateKeys();
      this.ecdh.computeSecret(ephA);
    } catch {
      throw new HandshakeError("invalid device ephemeral key");
    }

    const nonceS = randomBytes(32);
    const ephS = this.ecdh.getPublicKey();
    this.deviceId = h.deviceId;
    this.ephA = ephA;
    this.T = transcript(h.deviceId, nonceA, nonceS, ephA, ephS);

    return {
      type: "challenge",
      nonceS: b64(nonceS),
      ephS: b64(ephS),
      sigS: b64(signT(SERVER_CONTEXT, this.T, this.serverPrivateKey)),
    };
  }

  /**
   * Verifies the device signature with the key registered at enrollment.
   * Pass null for unknown/revoked/not-yet-active devices: it fails the same way as a bad signature.
   */
  onAuth(a: Auth, devicePublicKey: string | null): SecureChannel {
    if (!this.helloSeen || !this.T || !this.ephA || this.authSeen) throw new HandshakeError("unexpected auth");
    this.authSeen = true;

    const sig = Buffer.from(a.sigA, "base64");
    const ok = devicePublicKey
      ? verifyT(DEVICE_CONTEXT, this.T, sig, devicePublicKey)
      : // Same work as the real check so timing does not distinguish the cases.
        (verifyT(DEVICE_CONTEXT, this.T, sig, publicKeyOf(this.serverPrivateKey)), false);
    if (!ok) throw new HandshakeError("device authentication failed");

    return deriveChannel(this.ecdh.computeSecret(this.ephA), this.T, "server");
  }
}
