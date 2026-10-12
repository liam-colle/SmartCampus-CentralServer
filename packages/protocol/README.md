# @smartcampus/protocol and @smartcampus/handshake

The contract between the server and every device (Famoco door unit, edge agent, simulator).
Source of truth is the code; this is the map. Design rationale: `docs/SmartCampus-CentralServer_Technical_Deck.pdf`.

## Connection

1. The device opens `wss://<server>/ws/device` (devices always dial out).
2. Handshake, four messages (the first three are plain JSON text frames, base64 for binary fields):

   | # | From | Message |
   | - | --- | --- |
   | 1 | device | `hello {deviceId, nonceA(32B), ephA(65B P-256 point)}` |
   | 2 | server | `challenge {nonceS(32B), ephS, sigS}` |
   | 3 | device | `auth {sigA}` |
   | 4 | server | `session.ready` (first **encrypted** frame) |

   `T` = `deviceId ‖ nonceA ‖ nonceS ‖ ephA ‖ ephS`, each field prefixed by its 4-byte big-endian length.
   `sigS = ECDSA-P256-SHA256("smartcampus/v1/server\0" ‖ T)`, `sigA` likewise with `"smartcampus/v1/device\0"`, both DER.
   The device verifies `sigS` with the **provisioned** server public key; the server verifies `sigA` with the key registered at enrollment.
   Session keys: `HKDF-SHA256(ECDH(ephA, ephS), salt = SHA-256(T), info = "smartcampus/v1/session")`, 64 bytes: the first 32 encrypt device to server, the last 32 server to device.
   The handshake must finish within 10 s. Any failure closes with **4401** whatever the cause.

3. After the handshake every WebSocket frame is **binary**: `counter (8B BE) ‖ AES-256-GCM ciphertext ‖ tag (16B)`.
   IV = 4 zero bytes ‖ counter, AAD = `"c2s"` or `"s2c"`. The counter starts at 0 per direction and must be exactly the next value.
4. The plaintext is a JSON envelope: `{ v: 1, id: ULID, type, ts, seq, payload }`. `seq` starts at 1 per connection and direction and increases by 1.

## Messages

| Direction | Type | Payload |
| --- | --- | --- |
| S to D | `session.ready` | `{desired, serverTime, pendingCommands}` |
| S to D | `room.status.set` | `{roomId, status: free\|occupied\|reserved\|closed}` |
| S to D | `display.config.set` | `{config}` |
| S to D | `announce.show` | `{announcementId, title?, text, priority, expiresAt?}` |
| S to D | `audio.play` | `{assetId, sha256, size}` (audio is downloaded over signed HTTPS, never carried here) |
| S to D | `access.acl.sync` | `{rules: [{badgeUid, zones, validFrom?, validUntil?}]}` |
| D to S | `ack` / `nack` | `{ref}` / `{ref, reason}` where `ref` is the command's envelope `id` |
| D to S | `state.report` | `{state, telemetry?}` |
| D to S | `event.badge` | `{badgeUid, at, granted?}` |

Every type has a zod schema in `src/messages.ts`. The five command types (everything server to device except `session.ready`) must be acknowledged.

## Delivery rules

- Commands are stored in the outbox before sending (`pending, sent, acked`) and expire after their TTL.
- A command keeps the **same `id` on every resend**. A device remembers the ids it executed and, on a duplicate, acknowledges again without executing again.
- On reconnect the server sends `session.ready` (full desired state), then unacknowledged, unexpired commands in creation order.
- Devices reconnect with exponential backoff from 1 s to 60 s with jitter. The server pings every 25 s; two missed pongs mean offline.

## Close codes

`4400` protocol error (bad, replayed, oversized or out-of-order frame), `4401` authentication failed, `4403` revoked, `4408` handshake timeout, `4409` replaced by a newer connection, `4410` ping timeout, `4429` rate limited, `1009` message too big.

## Enrollment (REST)

`POST /api/enroll {publicKey (SPKI DER b64), type}` returns `{deviceId, code, fingerprint, expiresAt}`. The device shows `code` and `fingerprint`; an admin submits both to `POST /api/devices/enroll`. The private key never leaves the device.
