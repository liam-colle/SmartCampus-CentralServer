"""A simulated device connection: handshake, encrypted messages, and a realistic run loop."""

from __future__ import annotations

import asyncio
import json
import random
import sys
import threading
import time

import websockets
from websockets.asyncio.client import ClientConnection

from .crypto import ChannelError, DeviceHandshake, HandshakeError, SecureChannel, load_public_key
from .protocol import BACKOFF_MAX_S, BACKOFF_MIN_S, COMMAND_TYPES, dumps, envelope
from .state import DeviceIdentity


def ws_url(server: str) -> str:
    return server.replace("https://", "wss://").replace("http://", "ws://").rstrip("/") + "/ws/device"


class SimDevice:
    """One WebSocket connection to /ws/device. Steps are exposed separately so tests can break each one."""

    def __init__(self, server: str, device_id: str, device_key, server_public_key):
        self.url = ws_url(server)
        self.device_id = device_id
        self.handshake = DeviceHandshake(device_id, device_key, server_public_key)
        self.ws: ClientConnection | None = None
        self.channel: SecureChannel | None = None
        self.send_seq = 0
        self.recv_seq = 0

    # -- handshake steps --
    async def connect(self) -> None:
        self.ws = await websockets.connect(self.url, max_size=2**20, open_timeout=5, ping_interval=None)

    async def send_hello(self) -> None:
        await self.ws.send(dumps(self.handshake.hello()))

    async def recv_challenge(self, timeout: float = 5) -> dict:
        raw = await asyncio.wait_for(self.ws.recv(), timeout)
        if not isinstance(raw, str):
            raise HandshakeError("expected a text challenge")
        return json.loads(raw)

    async def send_auth(self, challenge: dict) -> None:
        auth, self.channel = self.handshake.on_challenge(challenge)  # raises HandshakeError if the server is not who we think
        await self.ws.send(dumps(auth))

    async def recv_ready(self, timeout: float = 5) -> dict:
        msg = await self.recv_message(timeout)
        if msg["type"] != "session.ready":
            raise HandshakeError(f"expected session.ready, got {msg['type']}")
        return msg

    async def do_handshake(self) -> dict:
        """connect -> hello -> challenge -> auth -> session.ready. Returns the session.ready message."""
        await self.connect()
        await self.send_hello()
        await self.send_auth(await self.recv_challenge())
        return await self.recv_ready()

    # -- encrypted messages --
    async def recv_message(self, timeout: float = 5) -> dict:
        raw = await asyncio.wait_for(self.ws.recv(), timeout)
        if isinstance(raw, str):
            raise ChannelError("server sent a plaintext frame after the handshake")
        msg = json.loads(self.channel.decrypt(raw))
        if msg["seq"] != self.recv_seq + 1:
            raise ChannelError(f"unexpected seq {msg['seq']} (expected {self.recv_seq + 1})")
        self.recv_seq = msg["seq"]
        return msg

    async def send_message(self, type_: str, payload: dict, seq: int | None = None, id_: str | None = None) -> dict:
        self.send_seq += 1
        msg = envelope(type_, payload, seq if seq is not None else self.send_seq, id_)
        await self.ws.send(self.channel.encrypt(dumps(msg)))
        return msg

    async def send_raw(self, data: bytes | str) -> None:
        await self.ws.send(data)

    async def wait_close(self, timeout: float = 5) -> int | None:
        """Waits for the socket to close and returns the close code the server used."""
        try:
            await asyncio.wait_for(self.ws.wait_closed(), timeout)
        except asyncio.TimeoutError:
            return None
        return self.ws.close_code

    async def close(self) -> None:
        if self.ws:
            await self.ws.close()


# ---- realistic device behaviour ------------------------------------------------------------

def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')}  {msg}", flush=True)


class DeviceBehaviour:
    """What a door unit does with what it receives: apply, deduplicate, acknowledge, report."""

    def __init__(self, ident: DeviceIdentity, ack: bool = True):
        self.ident = ident
        self.ack = ack
        self.state: dict = {}
        # announcementId -> expiresAt in ms (None: until cleared). The door app also hides them by itself at expiry.
        self.announcements: dict[str, int | None] = {}
        # Card serial numbers typed by the person driving the simulator (see `run --taps`).
        self.taps: asyncio.Queue[str] | None = None

    def report_state(self) -> dict:
        now_ms = int(time.time() * 1000)
        self.announcements = {a: e for a, e in self.announcements.items() if e is None or e > now_ms}
        return {**self.state, "announcements": sorted(self.announcements)}

    def apply_desired(self, desired: dict) -> None:
        if "roomStatus" in desired:
            self.state["roomStatus"] = desired["roomStatus"].get("status")
        if "displayConfig" in desired:
            self.state["displayConfig"] = desired["displayConfig"]
        for announcement_id, a in desired.get("announcements", {}).items():
            self.announcements[announcement_id] = a.get("expiresAt")
        registration = desired.get("registration")
        if registration:
            self.state["registration"] = registration["sessionId"]
        else:
            self.state.pop("registration", None)
        # The desired state is complete: no emergency in it means the alert is over, even if the clear was missed.
        emergency = desired.get("emergency")
        if emergency:
            self.state["emergency"] = emergency["emergencyId"]
        else:
            self.state.pop("emergency", None)

    def execute(self, msg: dict) -> None:
        t, p = msg["type"], msg["payload"]
        if t == "room.status.set":
            self.state["roomStatus"] = p["status"]
            log(f"  room {p['roomId']} is now {p['label']} ({p['status']}, {p['color']})")
        elif t == "room.info.set":
            self.state["room"] = p["code"]
            log(f"  linked to room {p['code']} ({p['building']}, floor {p['floor']})")
        elif t == "audio.settings.set":
            self.state["volume"] = p["volume"]
            log(f"  volume {p['volume']}, quiet hours {p['quietHours']}")
        elif t == "announce.clear":
            self.announcements.pop(p["announcementId"], None)
            log(f"  announcement {p['announcementId']} cleared")
        elif t == "display.config.set":
            self.state["displayConfig"] = p["config"]
            log(f"  display config updated: {p['config']}")
        elif t == "announce.show":
            self.announcements[p["announcementId"]] = p.get("expiresAt")
            log(f"  ANNOUNCEMENT [{p.get('priority', 'info')}] {p.get('title') or ''} {p['text']}")
        elif t == "audio.play":
            log(f"  would download asset {p['assetId']} ({p['size']} bytes) and verify sha256 {p['sha256'][:12]}...")
        elif t == "emergency.set":
            self.state["emergency"] = p["emergencyId"]
            log(f"  EMERGENCY {p['title']} ({p['kind']}){' [test, volume ' + str(p['testVolume']) + ']' if p['testMode'] else ''}: {p['instructions']}")
        elif t == "emergency.clear":
            # A clear for an alert that was replaced by a newer one must not end the newer one.
            if self.state.get("emergency") == p["emergencyId"]:
                self.state.pop("emergency", None)
            log(f"  emergency {p['emergencyId']} cleared")
        elif t == "registration.mode.set":
            if p["active"]:
                self.state["registration"] = p["sessionId"]
                log("  REGISTRATION MODE: cards presented now are collected, they do not log anyone in")
            else:
                self.state.pop("registration", None)
                log("  registration mode ended")
        elif t == "access.acl.sync":
            log(f"  access list synced: {len(p['rules'])} badge rule(s)")

    async def handle_session(self, dev: SimDevice, ready: dict) -> None:
        p = ready["payload"]
        log(f"session ready: {p['pendingCommands']} pending command(s), desired={json.dumps(p['desired'])}")
        self.apply_desired(p["desired"])
        await dev.send_message("state.report", {"state": self.report_state(), "telemetry": {"uptime": int(time.monotonic())}})

        pump = asyncio.create_task(self.pump_taps(dev))
        try:
            await self.receive_loop(dev)
        finally:
            pump.cancel()

    async def pump_taps(self, dev: SimDevice) -> None:
        """Presents every typed card to the server, like a reader would."""
        while self.taps is not None:
            uid = await self.taps.get()
            sent = await dev.send_message("event.badge", {"badgeUid": uid, "at": int(time.time() * 1000)})
            log(f"-> event.badge {uid}  id={sent['id']}")

    def on_card_result(self, p: dict) -> None:
        if p["maintenance"]:
            log(f"<- card.result: MAINTENANCE MENU OPEN for {p.get('name', '?')}")
        else:
            who = f" ({p['name']})" if p.get("name") else ""
            log(f"<- card.result: {p['outcome']}{who}, no menu")

    async def receive_loop(self, dev: SimDevice) -> None:
        while True:
            msg = await dev.recv_message(timeout=3600)
            if msg["type"] == "card.result":
                self.on_card_result(msg["payload"])
                continue
            if msg["type"] not in COMMAND_TYPES:
                log(f"ignoring unexpected message {msg['type']}")
                continue
            log(f"<- {msg['type']}  id={msg['id']}")
            if msg["id"] in self.ident.seen_ids:
                log("  duplicate id: not executed again")
            else:
                self.execute(msg)
                self.ident.seen_ids.append(msg["id"])
                self.ident.save()
                await dev.send_message("state.report", {"state": self.report_state()})
            if self.ack:
                await dev.send_message("ack", {"ref": msg["id"]})
                log(f"-> ack {msg['id']}")
            else:
                log("  (ack withheld: --no-ack)")


def read_taps_from_stdin(queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
    """One card serial number per line on stdin, in any hex notation. A thread because stdin blocks."""

    def reader() -> None:
        for line in sys.stdin:
            uid = line.strip()
            if uid:
                loop.call_soon_threadsafe(queue.put_nowait, uid)

    threading.Thread(target=reader, daemon=True).start()


async def run_device(
    server: str, ident: DeviceIdentity, server_key: str, ack: bool = True, reconnect: bool = True, taps: bool = False
) -> None:
    """Connect, behave like a device, reconnect with exponential backoff and jitter (1-60 s)."""
    if not ident.device_id:
        raise SystemExit("this device has no id yet: run `enroll` first")
    server_pub = load_public_key(server_key)
    behaviour = DeviceBehaviour(ident, ack)
    if taps:
        behaviour.taps = asyncio.Queue()
        read_taps_from_stdin(behaviour.taps, asyncio.get_running_loop())
    backoff = BACKOFF_MIN_S

    while True:
        dev = SimDevice(server, ident.device_id, ident.private_key, server_pub)
        try:
            log(f"connecting to {dev.url} as {ident.device_id}")
            ready = await dev.do_handshake()
            backoff = BACKOFF_MIN_S
            await behaviour.handle_session(dev, ready)
        except HandshakeError as exc:
            log(f"handshake aborted: {exc}")
        except ChannelError as exc:
            log(f"channel error: {exc}")
        except websockets.ConnectionClosed:
            log(f"connection closed by server (code {dev.ws.close_code if dev.ws else '?'})")
            if dev.ws and dev.ws.close_code == 4401:
                log("authentication failed: is the device approved in the console, and the server key right?")
        except (OSError, asyncio.TimeoutError) as exc:
            log(f"connection failed: {exc}")
        finally:
            await dev.close()

        if not reconnect:
            return
        delay = random.uniform(backoff / 2, backoff)  # jitter avoids a mass simultaneous reconnect
        log(f"reconnecting in {delay:.1f}s")
        await asyncio.sleep(delay)
        backoff = min(backoff * 2, BACKOFF_MAX_S)
