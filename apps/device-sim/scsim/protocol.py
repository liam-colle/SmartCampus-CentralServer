"""Envelope, ULID and constants (mirror of packages/protocol)."""

from __future__ import annotations

import json
import os
import re
import time

PROTOCOL_VERSION = 1
MAX_FRAME_BYTES = 64 * 1024
BACKOFF_MIN_S = 1.0
BACKOFF_MAX_S = 60.0

# WebSocket close codes used by the server.
CLOSE_PROTOCOL_ERROR = 4400
CLOSE_AUTH_FAILED = 4401
CLOSE_REVOKED = 4403
CLOSE_HANDSHAKE_TIMEOUT = 4408
CLOSE_REPLACED = 4409
CLOSE_PING_TIMEOUT = 4410
CLOSE_RATE_LIMITED = 4429

COMMAND_TYPES = {
    "room.status.set",
    "room.info.set",
    "display.config.set",
    "audio.settings.set",
    "announce.show",
    "announce.clear",
    "audio.play",
    "emergency.set",
    "emergency.clear",
    "access.acl.sync",
}

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32
ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def ulid(now_ms: int | None = None) -> str:
    """26-char ULID: 48-bit ms timestamp + 80 random bits."""
    t = int(time.time() * 1000) if now_ms is None else now_ms
    time_part = ""
    for _ in range(10):
        time_part = _ALPHABET[t % 32] + time_part
        t //= 32
    r = int.from_bytes(os.urandom(10), "big")
    rand_part = ""
    for _ in range(16):
        rand_part = _ALPHABET[r % 32] + rand_part
        r //= 32
    return time_part + rand_part


def envelope(type_: str, payload: dict, seq: int, id_: str | None = None) -> dict:
    return {"v": PROTOCOL_VERSION, "id": id_ or ulid(), "type": type_, "ts": int(time.time() * 1000), "seq": seq, "payload": payload}


def dumps(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":"))
