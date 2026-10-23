"""End-to-end protocol conformance run against a live server.

Drives the real REST API (as an admin) and the real WSS gateway (as devices), including hostile
behaviour: tampering, replay, wrong keys, a relaying proxy, revocation.
"""

from __future__ import annotations

import asyncio
import json
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse

import websockets

from . import protocol as P
from .api import Api, ApiError
from .crypto import (
    ChannelError,
    HandshakeError,
    b64,
    fingerprint,
    generate_identity,
    load_public_key,
    public_key_b64,
    unb64,
)
from .device import SimDevice, ws_url


class Runner:
    def __init__(self) -> None:
        self.results: list[tuple[str, bool, str]] = []

    async def check(self, name: str, fn) -> None:
        start = time.monotonic()
        try:
            await fn()
            self.results.append((name, True, ""))
            print(f"  PASS  {name}  ({time.monotonic() - start:.2f}s)", flush=True)
        except Exception as exc:  # noqa: BLE001 - report every failure kind
            detail = f"{type(exc).__name__}: {exc}"
            self.results.append((name, False, detail))
            print(f"  FAIL  {name}\n        {detail}", flush=True)
            if not isinstance(exc, AssertionError):
                traceback.print_exc()

    def summary(self) -> int:
        failed = [r for r in self.results if not r[1]]
        print(f"\n{len(self.results) - len(failed)}/{len(self.results)} checks passed")
        return 1 if failed else 0


def expect(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


async def api(fn, *args, **kwargs):
    """The REST client is blocking (stdlib); keep the event loop free while it runs."""
    return await asyncio.to_thread(fn, *args, **kwargs)


class Fleet:
    """Creates enrolled devices through the real two-step flow."""

    def __init__(self, server: str, server_pub_text: str, admin: Api):
        self.server = server
        self.server_pub_text = server_pub_text
        self.server_pub = load_public_key(server_pub_text)
        self.admin = admin
        self.public = Api(server)  # unauthenticated, like a device before enrollment

    async def enroll(self, type_: str = "door", approve: bool = True):
        key = generate_identity()
        req = await api(self.public.enroll_request, public_key_b64(key), type_, f"selftest {type_}")
        expect(req["fingerprint"] == fingerprint(public_key_b64(key)), "server fingerprint differs from the device's")
        if approve:
            await api(self.admin.approve, req["deviceId"])
        return key, req["deviceId"], req

    def device(self, key, device_id: str) -> SimDevice:
        return SimDevice(self.server, device_id, key, self.server_pub)

    async def online(self, key, device_id: str):
        dev = self.device(key, device_id)
        ready = await dev.do_handshake()
        return dev, ready


async def run(server: str, server_key_text: str, admin_email: str, admin_password: str) -> int:
    admin = Api(server)
    try:
        await api(admin.login, admin_email, admin_password)
    except (ApiError, OSError) as exc:
        print(f"cannot log in to {server} as {admin_email}: {exc}")
        return 2
    fleet = Fleet(server, server_key_text, admin)
    r = Runner()
    print(f"Protocol conformance run against {server}\n")

    # helper used by several checks below
    async def refused_handshake(key, did):
        dev = fleet.device(key, did)
        try:
            await dev.do_handshake()
        except websockets.ConnectionClosed:
            return dev.ws.close_code
        raise AssertionError("handshake unexpectedly succeeded")

    # ---- 1. happy path -----------------------------------------------------------------------
    print("Enrollment and handshake")

    async def enrollment_flow():
        key = generate_identity()
        req = await api(fleet.public.enroll_request, public_key_b64(key), "door", "lobby door")
        expect("code" not in req, "no code is involved any more")
        expect(await api(fleet.public.enrollment_status, req["deviceId"]) == "pending", "should be pending")
        waiting = {x["id"]: x for x in await api(admin.requests)}
        expect(req["deviceId"] in waiting, "the console should list the request")
        shown = waiting[req["deviceId"]]
        expect(shown["fingerprint"] == req["fingerprint"] == fingerprint(public_key_b64(key)), "console must show the key's fingerprint")
        expect(shown["name"] == "lobby door" and shown["type"] == "door", "console must show what the device asked for")
        done = await api(admin.approve, req["deviceId"], "Door B2-104")
        expect(done["status"] == "active" and done["name"] == "Door B2-104", "approval should activate the device under the chosen name")
        expect(await api(fleet.public.enrollment_status, req["deviceId"]) == "active", "device should see it is active")
        try:
            await api(admin.approve, req["deviceId"])
            raise AssertionError("a request can only be resolved once")
        except ApiError as exc:
            expect(exc.status == 404, f"expected 404, got {exc.status}")

    await r.check("enrollment: request, appears in the console, approved once", enrollment_flow)

    async def enrollment_denied():
        key = generate_identity()
        req = await api(fleet.public.enroll_request, public_key_b64(key), "display")
        await api(admin.deny, req["deviceId"])
        expect(await api(fleet.public.enrollment_status, req["deviceId"]) == "denied", "device should see it was denied")
        expect(req["deviceId"] not in [x["id"] for x in await api(admin.requests)], "denied request must leave the pending list")
        try:
            await api(fleet.public.enroll_request, public_key_b64(key), "display")
            raise AssertionError("a denied key must not be able to ask again at once")
        except ApiError as exc:
            expect(exc.status == 403, f"expected 403, got {exc.status}")
        code = await refused_handshake(key, req["deviceId"])
        expect(code == P.CLOSE_AUTH_FAILED, f"a denied device must not authenticate, got {code}")

    await r.check("enrollment: denied request never authenticates and cannot be re-asked", enrollment_denied)

    async def enrollment_retry():
        key = generate_identity()
        a = await api(fleet.public.enroll_request, public_key_b64(key), "door")
        b = await api(fleet.public.enroll_request, public_key_b64(key), "door")
        expect(a["deviceId"] == b["deviceId"], "retrying with the same key must return the same request")
        pending = [x for x in await api(admin.requests) if x["id"] == a["deviceId"]]
        expect(len(pending) == 1, "the console must show it once")
        await api(admin.deny, a["deviceId"])
        done_key, did, _ = await fleet.enroll()
        try:
            await api(fleet.public.enroll_request, public_key_b64(done_key), "door")
            raise AssertionError("an enrolled key must not enroll again")
        except ApiError as exc:
            expect(exc.status == 409, f"expected 409, got {exc.status}")

    await r.check("enrollment: same-key retry is idempotent, enrolled key is refused", enrollment_retry)

    async def enrollment_validation():
        try:
            await api(fleet.public.enroll_request, b64(b"not a key" * 12), "door")
            raise AssertionError("garbage must not be accepted as a public key")
        except ApiError as exc:
            expect(exc.status == 400, f"expected 400, got {exc.status}")

    await r.check("enrollment: a malformed public key is refused", enrollment_validation)

    async def handshake_ok():
        key, did, _ = await fleet.enroll()
        dev, ready = await fleet.online(key, did)
        expect(ready["type"] == "session.ready" and ready["seq"] == 1, "first message must be session.ready, seq 1")
        expect(P.ULID_RE.match(ready["id"]) is not None, "envelope id must be a ULID")
        info = await api(admin.device, did)
        expect(info["online"] is True, "console should see the device online")
        await dev.close()

    await r.check("handshake: mutual authentication, encrypted session.ready", handshake_ok)

    # ---- 2. commands, acks, replay -----------------------------------------------------------
    print("\nCommands and delivery guarantees")

    async def deliver_and_ack():
        key, did, _ = await fleet.enroll()
        dev, _ = await fleet.online(key, did)
        sent = await api(admin.send_command, did, "room.status.set", {"roomId": "B2-104", "status": "occupied"})
        expect(sent["delivered"] is True, "device is online, command should be delivered right away")
        msg = await dev.recv_message()
        expect(msg["type"] == "room.status.set" and msg["id"] == sent["id"], "wrong command received")
        expect(msg["payload"] == {"roomId": "B2-104", "status": "occupied"}, "payload altered")
        await dev.send_message("ack", {"ref": msg["id"]})
        await asyncio.sleep(0.3)
        status = {c["id"]: c["status"] for c in await api(admin.commands, did)}
        expect(status[msg["id"]] == "acked", f"command should be acked, is {status[msg['id']]}")
        await dev.close()

    await r.check("command delivered to an online device and acknowledged", deliver_and_ack)

    async def offline_replay():
        key, did, _ = await fleet.enroll()
        c1 = await api(admin.send_command, did, "announce.show", {"announcementId": "a1", "text": "Fire drill at 10:00"})
        c2 = await api(admin.send_command, did, "room.status.set", {"roomId": "B2-104", "status": "closed"})
        expect(c1["delivered"] is False, "offline device: command must wait in the outbox")

        dev, ready = await fleet.online(key, did)
        expect(ready["payload"]["pendingCommands"] == 2, "two commands should be pending")
        m1, m2 = await dev.recv_message(), await dev.recv_message()
        expect([m1["id"], m2["id"]] == [c1["id"], c2["id"]], "commands must arrive in creation order with their ids")
        await dev.send_message("ack", {"ref": m1["id"]})  # only the first one
        await asyncio.sleep(0.3)
        await dev.close()
        await asyncio.sleep(0.2)

        dev2, ready2 = await fleet.online(key, did)
        expect(ready2["payload"]["pendingCommands"] == 1, "only the unacknowledged command should come back")
        again = await dev2.recv_message()
        expect(again["id"] == c2["id"], "replay must keep the original id so the device can deduplicate")
        await dev2.close()

    await r.check("outbox: replay after reconnect, same ids, acked ones not resent", offline_replay)

    async def desired_state():
        key, did, _ = await fleet.enroll()
        await api(admin.send_command, did, "room.status.set", {"roomId": "B2-104", "status": "reserved"})
        dev, ready = await fleet.online(key, did)
        expect(
            ready["payload"]["desired"].get("roomStatus", {}).get("status") == "reserved",
            "session.ready must carry the full desired state",
        )
        await dev.send_message("state.report", {"state": {"roomStatus": "reserved"}, "telemetry": {"battery": 91}})
        await asyncio.sleep(0.3)
        info = await api(admin.device, did)
        expect(info["reported"] == {"roomStatus": "reserved"}, f"reported state not stored: {info['reported']}")
        expect(info["telemetry"] == {"battery": 91}, "telemetry not stored")
        await dev.close()

    await r.check("digital twin: desired state on connect, reported state stored", desired_state)

    async def invalid_command():
        _, did, _ = await fleet.enroll()
        for type_, payload in (("room.status.set", {"roomId": "r", "status": "exploded"}), ("self.destruct", {}), ("audio.play", {"assetId": "a", "sha256": "zz", "size": 1})):
            try:
                await api(admin.send_command, did, type_, payload)
                raise AssertionError(f"{type_} with an invalid payload must be refused")
            except ApiError as exc:
                expect(exc.status == 400, f"expected 400 for {type_}, got {exc.status}")

    await r.check("invalid commands are refused before reaching the outbox", invalid_command)

    # ---- 3. connection management -------------------------------------------------------------
    print("\nConnection management")

    async def replaced():
        key, did, _ = await fleet.enroll()
        first, _ = await fleet.online(key, did)
        second, _ = await fleet.online(key, did)
        code = await first.wait_close()
        expect(code == P.CLOSE_REPLACED, f"old connection should close with {P.CLOSE_REPLACED}, got {code}")
        expect((await api(admin.device, did))["online"] is True, "device must stay online after a takeover")
        await second.close()

    await r.check("a new connection replaces the old one (4409)", replaced)

    async def revoke():
        key, did, _ = await fleet.enroll()
        dev, _ = await fleet.online(key, did)
        await api(admin.revoke, did)
        code = await dev.wait_close()
        expect(code == P.CLOSE_REVOKED, f"expected {P.CLOSE_REVOKED}, got {code}")
        again = fleet.device(key, did)
        try:
            await again.do_handshake()
            raise AssertionError("a revoked device must not authenticate")
        except websockets.ConnectionClosed:
            expect(again.ws.close_code == P.CLOSE_AUTH_FAILED, f"expected {P.CLOSE_AUTH_FAILED}, got {again.ws.close_code}")

    await r.check("revocation closes the socket at once and blocks reconnection", revoke)

    # ---- 4. hostile behaviour -----------------------------------------------------------------
    print("\nHostile behaviour (all must be refused)")

    async def pending_device():
        key, did, _ = await fleet.enroll(approve=False)
        code = await refused_handshake(key, did)
        expect(code == P.CLOSE_AUTH_FAILED, f"got {code}")

    await r.check("device that is not approved yet -> 4401", pending_device)

    async def unknown_device():
        code = await refused_handshake(generate_identity(), P.ulid())
        expect(code == P.CLOSE_AUTH_FAILED, f"got {code}")

    await r.check("unknown device id -> 4401 (same answer as every other auth failure)", unknown_device)

    async def wrong_key():
        _, did, _ = await fleet.enroll()
        code = await refused_handshake(generate_identity(), did)
        expect(code == P.CLOSE_AUTH_FAILED, f"got {code}")

    await r.check("known device id but signature from another key -> 4401", wrong_key)

    async def garbage_hello():
        ws = await websockets.connect(ws_url(server), ping_interval=None)
        await ws.send("this is not json")
        await ws.wait_closed()
        expect(ws.close_code == P.CLOSE_PROTOCOL_ERROR, f"got {ws.close_code}")

    await r.check("garbage instead of hello -> 4400", garbage_hello)

    async def silent_client():
        ws = await websockets.connect(ws_url(server), ping_interval=None)
        await asyncio.wait_for(ws.wait_closed(), 15)
        expect(ws.close_code == P.CLOSE_HANDSHAKE_TIMEOUT, f"got {ws.close_code}")

    await r.check("client that never speaks is dropped after the handshake timeout -> 4408", silent_client)

    async def live(key, did):
        dev, _ = await fleet.online(key, did)
        return dev

    async def expect_protocol_error(dev, what):
        code = await dev.wait_close()
        expect(code == P.CLOSE_PROTOCOL_ERROR, f"{what}: expected {P.CLOSE_PROTOCOL_ERROR}, got {code}")

    async def plaintext_after_auth():
        key, did, _ = await fleet.enroll()
        dev = await live(key, did)
        await dev.send_raw(json.dumps(P.envelope("state.report", {"state": {}}, 1)))
        await expect_protocol_error(dev, "plaintext frame")

    await r.check("plaintext frame after the handshake -> 4400", plaintext_after_auth)

    async def tampered():
        key, did, _ = await fleet.enroll()
        dev = await live(key, did)
        frame = bytearray(dev.channel.encrypt(json.dumps(P.envelope("state.report", {"state": {}}, 1))))
        frame[12] ^= 0xFF
        await dev.send_raw(bytes(frame))
        await expect_protocol_error(dev, "tampered frame")

    await r.check("tampered ciphertext (GCM tag) -> 4400", tampered)

    async def replayed():
        key, did, _ = await fleet.enroll()
        dev = await live(key, did)
        frame = dev.channel.encrypt(json.dumps(P.envelope("state.report", {"state": {}}, 1)))
        await dev.send_raw(frame)
        await dev.send_raw(frame)
        await expect_protocol_error(dev, "replayed frame")

    await r.check("replayed frame -> 4400", replayed)

    async def bad_seq():
        key, did, _ = await fleet.enroll()
        dev = await live(key, did)
        await dev.send_message("state.report", {"state": {}}, seq=7)
        await expect_protocol_error(dev, "bad seq")

    await r.check("envelope seq out of order -> 4400", bad_seq)

    async def bad_payload():
        key, did, _ = await fleet.enroll()
        dev = await live(key, did)
        await dev.send_message("ack", {"ref": "not-a-ulid"})
        await expect_protocol_error(dev, "invalid payload")

    await r.check("authentic frame with a payload that fails the schema -> 4400", bad_payload)

    async def wrong_direction():
        key, did, _ = await fleet.enroll()
        dev = await live(key, did)
        await dev.send_message("room.status.set", {"roomId": "r", "status": "free"})  # a server->device type
        await expect_protocol_error(dev, "wrong direction")

    await r.check("device sending a server-only message type -> 4400", wrong_direction)

    async def oversized():
        key, did, _ = await fleet.enroll()
        dev = await live(key, did)
        await dev.send_raw(b"\x01" * 200_000)
        code = await dev.wait_close()
        expect(code == 1009, f"expected 1009 (message too big), got {code}")

    await r.check("oversized frame -> 1009", oversized)

    async def other_device_ack():
        ka, a, _ = await fleet.enroll()
        kb, b, _ = await fleet.enroll()
        c = await api(admin.send_command, a, "room.status.set", {"roomId": "r", "status": "free"})
        devb = await live(kb, b)
        await devb.send_message("ack", {"ref": c["id"]})
        await asyncio.sleep(0.3)
        status = {x["id"]: x["status"] for x in await api(admin.commands, a)}
        expect(status[c["id"]] != "acked", "a device must not be able to acknowledge another device's command")
        await devb.close()

    await r.check("a device cannot acknowledge another device's command", other_device_ack)

    async def relay_attack():
        """A man-in-the-middle terminates the connection and relays it, altering the server's ephemeral key."""
        key, did, _ = await fleet.enroll()
        target = ws_url(server)

        async def relay(client):
            async with websockets.connect(target, ping_interval=None) as upstream:
                async def up():
                    async for m in client:
                        await upstream.send(m)

                async def down():
                    async for m in upstream:
                        if isinstance(m, str) and '"challenge"' in m:
                            obj = json.loads(m)
                            raw = bytearray(unb64(obj["ephS"]))
                            raw[5] ^= 0x01  # swap the server's ephemeral key for the relay's own
                            obj["ephS"] = b64(bytes(raw))
                            m = json.dumps(obj)
                        await client.send(m)

                await asyncio.gather(up(), down(), return_exceptions=True)

        from websockets.asyncio.server import serve

        async with serve(relay, "127.0.0.1", 0) as srv:
            port = srv.sockets[0].getsockname()[1]
            dev = SimDevice(f"http://127.0.0.1:{port}", did, key, fleet.server_pub)
            await dev.connect()
            await dev.send_hello()
            challenge = await dev.recv_challenge()
            try:
                await dev.send_auth(challenge)
                raise AssertionError("device accepted a challenge that was altered by a relay")
            except HandshakeError:
                pass  # the device refuses to authenticate itself to the relay
            await dev.close()

    await r.check("relay altering the server's ephemeral key: device aborts, never sends auth", relay_attack)

    async def impostor_server():
        """A server that does not hold the provisioned key cannot make a device authenticate."""
        key, did, _ = await fleet.enroll()
        other = generate_identity()
        impostor = SimDevice(server, did, key, load_public_key(public_key_b64(other)))  # device provisioned with another key
        await impostor.connect()
        await impostor.send_hello()
        try:
            await impostor.send_auth(await impostor.recv_challenge())
            raise AssertionError("device accepted an unknown server key")
        except HandshakeError:
            pass
        await impostor.close()

    await r.check("device provisioned with a different server key refuses the gateway", impostor_server)

    return r.summary()
