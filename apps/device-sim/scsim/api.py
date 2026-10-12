"""Tiny REST client (stdlib only) for the enrollment and console endpoints."""

from __future__ import annotations

import http.cookiejar
import json
import urllib.error
import urllib.request


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message


class Api:
    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self._opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def _call(self, method: str, path: str, body: dict | None = None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"{self.base}/api{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        try:
            with self._opener.open(req, timeout=10) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            try:
                message = json.loads(err.read()).get("error", err.reason)
            except Exception:
                message = err.reason
            raise ApiError(err.code, message) from None

    # -- public (device) --
    def enroll_request(self, public_key: str, type_: str, name: str | None = None) -> dict:
        return self._call("POST", "/enroll", {"publicKey": public_key, "type": type_, **({"name": name} if name else {})})

    def enrollment_status(self, device_id: str) -> str:
        return self._call("GET", f"/enroll/{device_id}")["status"]

    # -- console (admin/operator session) --
    def login(self, email: str, password: str) -> dict:
        return self._call("POST", "/auth/login", {"email": email, "password": password})

    def approve(self, code: str, fingerprint: str, name: str, room: str | None = None) -> dict:
        body = {"code": code, "fingerprint": fingerprint, "name": name}
        if room:
            body["room"] = room
        return self._call("POST", "/devices/enroll", body)

    def device(self, device_id: str) -> dict:
        return self._call("GET", f"/devices/{device_id}")

    def revoke(self, device_id: str) -> dict:
        return self._call("POST", f"/devices/{device_id}/revoke")

    def send_command(self, device_id: str, type_: str, payload: dict, ttl_seconds: int | None = None) -> dict:
        body = {"type": type_, "payload": payload}
        if ttl_seconds:
            body["ttlSeconds"] = ttl_seconds
        return self._call("POST", f"/devices/{device_id}/commands", body)

    def commands(self, device_id: str) -> list[dict]:
        return self._call("GET", f"/devices/{device_id}/commands")["items"]
