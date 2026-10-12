"""Device side of the handshake and the encrypted channel.

Mirror of packages/handshake (TypeScript). Both must stay byte-for-byte compatible:
  T   = len-prefixed(deviceId || nonceA || nonceS || ephA || ephS)
  sig = ECDSA-P256-SHA256(context || T), DER, context differs for server and device
  key = HKDF-SHA256(ECDH(ephA, ephS), salt=SHA256(T), info="smartcampus/v1/session") -> 64 bytes
        bytes 0..32 encrypt device->server, bytes 32..64 server->device
  frame = counter(8, big endian) || AES-256-GCM ciphertext || tag(16), IV = 4 zero bytes || counter
"""

from __future__ import annotations

import base64
import hashlib
import os
import struct

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PROTOCOL_VERSION = 1
SERVER_CONTEXT = b"smartcampus/v1/server\0"
DEVICE_CONTEXT = b"smartcampus/v1/device\0"
SESSION_INFO = b"smartcampus/v1/session"
TAG_LEN = 16
COUNTER_LEN = 8


class HandshakeError(Exception):
    pass


class ChannelError(Exception):
    pass


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def unb64(s: str) -> bytes:
    return base64.b64decode(s)


# ---- identity keys -------------------------------------------------------------------------

def generate_identity() -> ec.EllipticCurvePrivateKey:
    """New ECDSA P-256 key pair. On a real device the private key lives in a Keystore/TPM."""
    return ec.generate_private_key(ec.SECP256R1())


def private_key_to_pem(key: ec.EllipticCurvePrivateKey) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


def private_key_from_pem(pem: str) -> ec.EllipticCurvePrivateKey:
    return serialization.load_pem_private_key(pem.encode(), password=None)  # type: ignore[return-value]


def public_key_b64(key: ec.EllipticCurvePrivateKey | ec.EllipticCurvePublicKey) -> str:
    """SPKI DER, base64: the format the server stores at enrollment."""
    pub = key.public_key() if isinstance(key, ec.EllipticCurvePrivateKey) else key
    return b64(pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))


def load_public_key(text: str) -> ec.EllipticCurvePublicKey:
    """Accepts SPKI as base64 DER (the server-key.pub file) or PEM."""
    text = text.strip()
    if "BEGIN" in text:
        key = serialization.load_pem_public_key(text.encode())
    else:
        key = serialization.load_der_public_key(unb64(text))
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("expected an ECDSA P-256 public key")
    return key


def fingerprint(public_key: str) -> str:
    """SHA-256 of the SPKI DER (lowercase hex): what the device shows and the admin confirms."""
    return hashlib.sha256(unb64(public_key_b64(load_public_key(public_key)))).hexdigest()


def format_fingerprint(fp: str) -> str:
    fp = fp.upper()
    return " ".join(fp[i : i + 4] for i in range(0, len(fp), 4))


# ---- channel -------------------------------------------------------------------------------

class SecureChannel:
    def __init__(self, send_key: bytes, recv_key: bytes, send_label: bytes, recv_label: bytes):
        self._send = AESGCM(send_key)
        self._recv = AESGCM(recv_key)
        self._send_label = send_label
        self._recv_label = recv_label
        self.send_counter = 0
        self.recv_counter = 0

    @staticmethod
    def _iv(counter: int) -> bytes:
        return b"\0\0\0\0" + struct.pack(">Q", counter)

    def encrypt(self, plaintext: bytes | str) -> bytes:
        if isinstance(plaintext, str):
            plaintext = plaintext.encode()
        counter = self.send_counter
        self.send_counter += 1
        body = self._send.encrypt(self._iv(counter), plaintext, self._send_label)  # ciphertext || tag
        return struct.pack(">Q", counter) + body

    def decrypt(self, frame: bytes) -> bytes:
        if len(frame) < COUNTER_LEN + TAG_LEN:
            raise ChannelError("frame too short")
        (counter,) = struct.unpack(">Q", frame[:COUNTER_LEN])
        if counter != self.recv_counter:
            raise ChannelError("unexpected frame counter")
        try:
            plain = self._recv.decrypt(self._iv(counter), frame[COUNTER_LEN:], self._recv_label)
        except Exception as exc:  # InvalidTag
            raise ChannelError("authentication failed") from exc
        self.recv_counter += 1
        return plain


# ---- handshake -----------------------------------------------------------------------------

def _lp(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b


def transcript(device_id: str, nonce_a: bytes, nonce_s: bytes, eph_a: bytes, eph_s: bytes) -> bytes:
    return b"".join(_lp(p) for p in (device_id.encode(), nonce_a, nonce_s, eph_a, eph_s))


class DeviceHandshake:
    """hello() -> (server) challenge -> on_challenge() -> auth message + channel."""

    def __init__(
        self,
        device_id: str,
        device_key: ec.EllipticCurvePrivateKey,
        server_public_key: ec.EllipticCurvePublicKey,
    ):
        self.device_id = device_id
        self.device_key = device_key
        self.server_public_key = server_public_key
        self._eph = ec.generate_private_key(ec.SECP256R1())
        self._eph_a = self._eph.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        self._nonce_a = os.urandom(32)

    def hello(self) -> dict:
        return {
            "type": "hello",
            "v": PROTOCOL_VERSION,
            "deviceId": self.device_id,
            "nonceA": b64(self._nonce_a),
            "ephA": b64(self._eph_a),
        }

    def on_challenge(self, ch: dict) -> tuple[dict, SecureChannel]:
        nonce_s = unb64(ch["nonceS"])
        eph_s = unb64(ch["ephS"])
        t = transcript(self.device_id, self._nonce_a, nonce_s, self._eph_a, eph_s)

        # The server key is provisioned on the device: this is what defeats a relaying proxy.
        try:
            self.server_public_key.verify(unb64(ch["sigS"]), SERVER_CONTEXT + t, ec.ECDSA(hashes.SHA256()))
        except InvalidSignature as exc:
            raise HandshakeError("server signature invalid") from exc

        try:
            peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), eph_s)
        except ValueError as exc:
            raise HandshakeError("invalid server ephemeral key") from exc
        shared = self._eph.exchange(ec.ECDH(), peer)

        okm = HKDF(
            algorithm=hashes.SHA256(),
            length=64,
            salt=hashlib.sha256(t).digest(),
            info=SESSION_INFO,
        ).derive(shared)
        channel = SecureChannel(okm[:32], okm[32:], b"c2s", b"s2c")

        sig_a = self.device_key.sign(DEVICE_CONTEXT + t, ec.ECDSA(hashes.SHA256()))
        return {"type": "auth", "sigA": b64(sig_a)}, channel
