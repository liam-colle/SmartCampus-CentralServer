import type { SecureChannel } from "@smartcampus/handshake";
import { buildMessage, type CommandType, type ServerMessage } from "@smartcampus/protocol";
import type { WebSocket } from "ws";
import { markSent, pendingCommands } from "../domain/commands.js";

/** An authenticated device connection: encrypted channel + per-direction sequence numbers. */
export class DeviceConnection {
  private sendSeq = 0;
  /** Last `seq` accepted from the device. */
  recvSeq = 0;
  missedPongs = 0;
  /** Commands are only sent after session.ready, so the device sees the desired state first. */
  private ready = false;
  /** Command ids already sent on THIS connection (a reconnect starts empty, so everything is replayed). */
  private readonly sentIds = new Set<string>();
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    readonly deviceId: string,
    private readonly ws: WebSocket,
    private readonly channel: SecureChannel,
  ) {}

  decryptFrame(frame: Buffer): Buffer {
    return this.channel.decrypt(frame);
  }

  get open(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }

  send<T extends ServerMessage["type"]>(type: T, payload: Extract<ServerMessage, { type: T }>["payload"], id?: string) {
    const msg = buildMessage<ServerMessage>({ type, payload, id } as never, ++this.sendSeq);
    this.ws.send(this.channel.encrypt(JSON.stringify(msg)), { binary: true });
    return msg;
  }

  /** Sends every pending command that this connection has not sent yet, in order. Calls are serialised. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (!this.ready) return;
      for (const cmd of await pendingCommands(this.deviceId)) {
        if (!this.open) return;
        if (this.sentIds.has(cmd.commandId)) continue;
        this.send(cmd.type as CommandType, cmd.payload as never, cmd.commandId);
        this.sentIds.add(cmd.commandId);
        await markSent(cmd.commandId);
      }
    });
    return this.flushing;
  }

  markReady() {
    this.ready = true;
  }

  close(code: number, reason: string) {
    this.ws.close(code, reason);
  }

  terminate() {
    this.ws.terminate();
  }
}
