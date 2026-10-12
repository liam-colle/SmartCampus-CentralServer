import { createCipheriv, createDecipheriv } from "node:crypto";

export class ChannelError extends Error {}

const TAG_LEN = 16;
const COUNTER_LEN = 8;

/**
 * AES-256-GCM, one key per direction. The IV is derived from a per-direction frame counter, which
 * is also sent in clear in front of every frame: the receiver requires it to be exactly the next
 * expected value, so replayed, dropped, reordered or reflected frames fail.
 *
 * Frame = counter (8 bytes, big endian) || ciphertext || tag (16 bytes). AAD = direction label.
 */
export class SecureChannel {
  private sendCounter = 0;
  private recvCounter = 0;

  constructor(
    private readonly sendKey: Buffer,
    private readonly recvKey: Buffer,
    private readonly sendLabel: string,
    private readonly recvLabel: string,
  ) {}

  private iv(counter: number): Buffer {
    const iv = Buffer.alloc(12);
    iv.writeBigUInt64BE(BigInt(counter), 4);
    return iv;
  }

  encrypt(plaintext: Buffer | string): Buffer {
    const counter = this.sendCounter++;
    if (counter > Number.MAX_SAFE_INTEGER) throw new ChannelError("counter exhausted");
    const cipher = createCipheriv("aes-256-gcm", this.sendKey, this.iv(counter));
    cipher.setAAD(Buffer.from(this.sendLabel));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const head = Buffer.alloc(COUNTER_LEN);
    head.writeBigUInt64BE(BigInt(counter));
    return Buffer.concat([head, body, cipher.getAuthTag()]);
  }

  /** Throws ChannelError on any problem. After an error the channel must be discarded. */
  decrypt(frame: Buffer): Buffer {
    if (frame.length < COUNTER_LEN + TAG_LEN) throw new ChannelError("frame too short");
    const counter = Number(frame.readBigUInt64BE(0));
    if (counter !== this.recvCounter) throw new ChannelError("unexpected frame counter");

    const decipher = createDecipheriv("aes-256-gcm", this.recvKey, this.iv(counter));
    decipher.setAAD(Buffer.from(this.recvLabel));
    decipher.setAuthTag(frame.subarray(frame.length - TAG_LEN));
    try {
      const plain = Buffer.concat([
        decipher.update(frame.subarray(COUNTER_LEN, frame.length - TAG_LEN)),
        decipher.final(),
      ]);
      this.recvCounter++;
      return plain;
    } catch {
      throw new ChannelError("authentication failed");
    }
  }
}
