"""Persistent identity of a simulated device (stands in for the Keystore / 0600 key file)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from .crypto import fingerprint, generate_identity, private_key_from_pem, private_key_to_pem, public_key_b64


@dataclass
class DeviceIdentity:
    name: str
    type: str
    private_key_pem: str
    public_key: str
    device_id: str | None = None
    # Command ids already executed: lets the device ignore replays after a reconnect.
    seen_ids: list[str] = field(default_factory=list)
    path: Path | None = None

    @property
    def private_key(self):
        return private_key_from_pem(self.private_key_pem)

    @property
    def fingerprint(self) -> str:
        return fingerprint(self.public_key)

    @classmethod
    def create(cls, name: str, type_: str, state_dir: Path) -> "DeviceIdentity":
        key = generate_identity()
        ident = cls(name=name, type=type_, private_key_pem=private_key_to_pem(key), public_key=public_key_b64(key))
        ident.path = state_dir / f"{name}.json"
        return ident

    @classmethod
    def load(cls, name: str, state_dir: Path) -> "DeviceIdentity":
        path = state_dir / f"{name}.json"
        if not path.exists():
            raise FileNotFoundError(f"no device named '{name}' in {state_dir} (run: enroll --name {name})")
        data = json.loads(path.read_text())
        ident = cls(
            name=data["name"],
            type=data["type"],
            private_key_pem=data["private_key_pem"],
            public_key=data["public_key"],
            device_id=data.get("device_id"),
            seen_ids=data.get("seen_ids", []),
        )
        ident.path = path
        return ident

    def save(self) -> None:
        assert self.path is not None
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "name": self.name,
            "type": self.type,
            "device_id": self.device_id,
            "public_key": self.public_key,
            "private_key_pem": self.private_key_pem,
            "seen_ids": self.seen_ids[-1000:],
        }
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        os.chmod(tmp, 0o600)  # the private key never leaves this file
        tmp.replace(self.path)
