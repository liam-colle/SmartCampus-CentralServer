import { DeviceHandshake, type SecureChannel } from "@smartcampus/handshake";
import {
  buildMessage,
  parseServerMessage,
  type DeviceMessage,
  type ServerMessage,
  type ServerMessageType,
} from "@smartcampus/protocol";
import { WebSocket } from "ws";

/** Minimal protocol-speaking device used by the integration tests. */
export class TestDevice {
  readonly ws: WebSocket;
  readonly inbox: ServerMessage[] = [];
  closeCode: number | null = null;
  /** Set when the device itself aborts the handshake (e.g. the server signature is invalid). */
  handshakeError: Error | null = null;
  readonly closed: Promise<number>;
  private channel: SecureChannel | null = null;
  private sendSeq = 0;
  private waiters: Array<() => void> = [];
  private readonly handshake: DeviceHandshake;
  readonly ready: Promise<void>;

  constructor(
    url: string,
    private readonly deviceId: string,
    devicePrivateKey: string,
    serverPublicKey: string,
    wsOptions: ConstructorParameters<typeof WebSocket>[2] = {},
  ) {
    this.handshake = new DeviceHandshake({ deviceId, devicePrivateKey, serverPublicKey });
    this.ws = new WebSocket(`${url}/ws/device`, wsOptions);

    this.closed = new Promise((resolve) =>
      this.ws.on("close", (code) => {
        this.closeCode = code;
        this.notify();
        resolve(code);
      }),
    );
    this.ws.on("error", () => {});
    this.ready = new Promise((resolve) => {
      this.ws.on("open", () => this.ws.send(JSON.stringify(this.handshake.hello())));
      this.ws.on("message", (data: Buffer, isBinary) => {
        if (!isBinary) {
          try {
            const { auth, channel } = this.handshake.onChallenge(JSON.parse(data.toString()));
            this.channel = channel;
            this.ws.send(JSON.stringify(auth));
          } catch (err) {
            // A real device drops the connection when the server cannot prove its identity.
            this.handshakeError = err as Error;
            this.ws.close(1000);
          }
          return;
        }
        const parsed = parseServerMessage(this.channel!.decrypt(data));
        if (!parsed.ok) throw new Error(parsed.error);
        this.inbox.push(parsed.message);
        if (parsed.message.type === "session.ready") resolve();
        this.notify();
      });
      void this.closed.then(() => resolve());
    });
  }

  private notify() {
    for (const w of this.waiters.splice(0)) w();
  }

  /** Resolves with the next message of `type` that has not been consumed yet. */
  async next<T extends ServerMessageType>(type: T, timeoutMs = 3000): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (this.closeCode !== null) throw new Error(`socket closed (${this.closeCode}) while waiting for ${type}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${type}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, left);
      });
    }
  }

  send<T extends DeviceMessage["type"]>(type: T, payload: Extract<DeviceMessage, { type: T }>["payload"], seq?: number) {
    const msg = buildMessage<DeviceMessage>({ type, payload } as never, seq ?? ++this.sendSeq);
    this.ws.send(this.channel!.encrypt(JSON.stringify(msg)), { binary: true });
    return msg;
  }

  /** Bypass the channel: write bytes exactly as given. */
  sendRaw(data: Buffer | string, binary = true) {
    this.ws.send(data, { binary });
  }

  encrypt(text: string) {
    return this.channel!.encrypt(text);
  }

  close() {
    this.ws.close();
  }
}
