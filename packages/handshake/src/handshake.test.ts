import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ulid } from "@smartcampus/protocol";
import { ChannelError, DeviceHandshake, HandshakeError, ServerHandshake, fingerprint, generateIdentity } from "./index.js";

const server = generateIdentity();
const device = generateIdentity();
const deviceId = ulid();

function setup(over: Partial<{ serverPublicKey: string; devicePrivateKey: string }> = {}) {
  return {
    dev: new DeviceHandshake({
      deviceId,
      devicePrivateKey: over.devicePrivateKey ?? device.privateKey,
      serverPublicKey: over.serverPublicKey ?? server.publicKey,
    }),
    srv: new ServerHandshake(server.privateKey),
  };
}

function run() {
  const { dev, srv } = setup();
  const challenge = srv.onHello(dev.hello());
  const { auth, channel: devChannel } = dev.onChallenge(challenge);
  const srvChannel = srv.onAuth(auth, device.publicKey);
  return { devChannel, srvChannel };
}

describe("handshake", () => {
  it("completes and yields a working encrypted channel in both directions", () => {
    const { devChannel, srvChannel } = run();
    expect(srvChannel.decrypt(devChannel.encrypt("hello server")).toString()).toBe("hello server");
    expect(devChannel.decrypt(srvChannel.encrypt("hello device")).toString()).toBe("hello device");
  });

  it("derives different keys on every run", () => {
    const a = run();
    const b = run();
    expect(() => b.srvChannel.decrypt(a.devChannel.encrypt("x"))).toThrow(ChannelError);
  });

  it("device rejects a server that does not own the provisioned key (impostor / relay)", () => {
    const impostor = new ServerHandshake(generateIdentity().privateKey);
    const dev = new DeviceHandshake({ deviceId, devicePrivateKey: device.privateKey, serverPublicKey: server.publicKey });
    expect(() => dev.onChallenge(impostor.onHello(dev.hello()))).toThrow(HandshakeError);
  });

  it("server rejects a device signing with another key", () => {
    const { dev, srv } = setup({ devicePrivateKey: generateIdentity().privateKey });
    const { auth } = dev.onChallenge(srv.onHello(dev.hello()));
    expect(() => srv.onAuth(auth, device.publicKey)).toThrow(HandshakeError);
  });

  it("server rejects unknown or revoked devices exactly like a bad signature", () => {
    const { dev, srv } = setup();
    const { auth } = dev.onChallenge(srv.onHello(dev.hello()));
    expect(() => srv.onAuth(auth, null)).toThrow(HandshakeError);
  });

  it("a relay that swaps the ephemeral keys breaks the signatures", () => {
    const { dev, srv } = setup();
    const other = setup();
    const helloFromDevice = dev.hello();
    const forged = { ...helloFromDevice, ephA: other.dev.hello().ephA };
    const challenge = srv.onHello(forged);
    // Device checks T that includes its own ephA: server signed a different one.
    expect(() => dev.onChallenge(challenge)).toThrow(HandshakeError);
  });

  it("a relay that swaps the server ephemeral key is detected by the device", () => {
    const { dev, srv } = setup();
    const challenge = srv.onHello(dev.hello());
    const other = setup();
    const forged = { ...challenge, ephS: other.srv.onHello(other.dev.hello()).ephS };
    expect(() => dev.onChallenge(forged)).toThrow(HandshakeError);
  });

  it("a device signature cannot be replayed as a server signature (domain separation)", () => {
    const { dev, srv } = setup();
    const challenge = srv.onHello(dev.hello());
    const { auth } = dev.onChallenge(challenge);
    const reflected = { ...challenge, sigS: auth.sigA };
    const dev2 = new DeviceHandshake({ deviceId, devicePrivateKey: device.privateKey, serverPublicKey: device.publicKey });
    expect(() => dev2.onChallenge(reflected)).toThrow(HandshakeError);
  });

  it("rejects an ephemeral key that is not on the curve", () => {
    const { dev, srv } = setup();
    const hello = dev.hello();
    expect(() => srv.onHello({ ...hello, ephA: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64") })).toThrow(
      HandshakeError,
    );
  });

  it("is single use: second auth or hello is refused", () => {
    const { dev, srv } = setup();
    const hello = dev.hello();
    const ch = srv.onHello(hello);
    expect(() => srv.onHello(hello)).toThrow(HandshakeError);
    const { auth } = dev.onChallenge(ch);
    srv.onAuth(auth, device.publicKey);
    expect(() => srv.onAuth(auth, device.publicKey)).toThrow(HandshakeError);
  });
});

describe("secure channel", () => {
  it("rejects tampered ciphertext", () => {
    const { devChannel, srvChannel } = run();
    const frame = devChannel.encrypt("open the door");
    frame[10] ^= 0xff;
    expect(() => srvChannel.decrypt(frame)).toThrow(ChannelError);
  });

  it("rejects a replayed frame", () => {
    const { devChannel, srvChannel } = run();
    const frame = devChannel.encrypt("once");
    srvChannel.decrypt(frame);
    expect(() => srvChannel.decrypt(frame)).toThrow(ChannelError);
  });

  it("rejects dropped or reordered frames", () => {
    const { devChannel, srvChannel } = run();
    const first = devChannel.encrypt("1");
    const second = devChannel.encrypt("2");
    expect(() => srvChannel.decrypt(second)).toThrow(ChannelError);
    expect(srvChannel.decrypt(first).toString()).toBe("1");
  });

  it("rejects a frame reflected back to its sender", () => {
    const { devChannel } = run();
    const frame = devChannel.encrypt("echo");
    expect(() => devChannel.decrypt(frame)).toThrow(ChannelError);
  });

  it("rejects truncated frames", () => {
    const { srvChannel } = run();
    expect(() => srvChannel.decrypt(Buffer.alloc(5))).toThrow(ChannelError);
  });
});

describe("keys", () => {
  it("fingerprints are stable 64-char hex", () => {
    expect(fingerprint(device.publicKey)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(device.publicKey)).toBe(fingerprint(device.publicKey));
  });
});
