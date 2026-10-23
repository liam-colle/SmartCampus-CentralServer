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
| S to D | `room.status.set` | `{roomId, status, label, color, icon, since?}`: the status key travels with its label, `#rrggbb` colour and an icon name (`STATUS_ICONS`), so a device needs no catalogue |
| S to D | `room.info.set` | `{roomId, code, name, building, floor, capacity}`: what a door screen shows about its room |
| S to D | `display.config.set` | `{config: {layout, theme, accentColor, show{...}, sleep{enabled, from, to}}}`, every field has a default |
| S to D | `audio.settings.set` | `{volume 0-100, quietHours{enabled, from, to}}`: audio inside quiet hours is acknowledged, not played |
| S to D | `announce.show` | `{announcementId, title?, text, priority: info\|important\|urgent, expiresAt?}`: the device hides it at `expiresAt` by itself |
| S to D | `announce.clear` | `{announcementId}` |
| S to D | `audio.play` | `{announcementId, title?, assetId, sha256, size}` (audio is downloaded over signed HTTPS, never carried here) |
| S to D | `access.acl.sync` | `{rules: [{badgeUid, zones, validFrom?, validUntil?}]}` |
| D to S | `ack` / `nack` | `{ref}` / `{ref, reason}` where `ref` is the command's envelope `id` |
| D to S | `state.report` | `{state, telemetry?}` |
| D to S | `event.badge` | `{badgeUid, at, granted?}` |

Every type has a zod schema in `src/messages.ts`. Every server to device type except `session.ready` is a command and must be acknowledged. Time windows (`sleep`, `quietHours`) are local to the device and may cross midnight (`from` later than `to`).

## Delivery rules

- Commands are stored in the outbox before sending (`pending, sent, acked`) and expire after their TTL.
- A command keeps the **same `id` on every resend**. A device remembers the ids it executed and, on a duplicate, acknowledges again without executing again.
- On reconnect the server sends `session.ready` (full desired state), then unacknowledged, unexpired commands in creation order.
- Devices reconnect with exponential backoff from 1 s to 60 s with jitter. The server pings every 25 s; two missed pongs mean offline.

## Close codes

`4400` protocol error (bad, replayed, oversized or out-of-order frame), `4401` authentication failed, `4403` revoked, `4408` handshake timeout, `4409` replaced by a newer connection, `4410` ping timeout, `4429` rate limited, `1009` message too big.

## Enrollment (REST)

1. The device generates its key pair (the private key never leaves it) and posts `POST /api/enroll {publicKey (SPKI DER b64), type, name?}`. The reply is `{deviceId, fingerprint, expiresAt}`. Posting the same key again while the request is pending returns the same request.
2. The device polls `GET /api/enroll/:deviceId` (`pending`, `active`, `denied`, `expired`, `revoked`, `unknown`) and may show the fingerprint so the admin can compare.
3. In the console an admin or operator sees the request live (`/ws/admin` event `enrollment.requested`) and approves (`POST /api/devices/requests/:id/approve {name?, room?, groups?}`) or denies it (`.../deny`).
4. Once `active`, the device completes the handshake above with the key it registered.

Safeguards: per-address rate limit, a cap on pending requests, request expiry, a denied key is refused for an hour, an enrolled or revoked key cannot enroll again (generate a new one).

## Signed asset download

`audio.play` names an asset; the device fetches `GET /api/assets/:assetId/download` with three headers: `X-Device-Id`, `X-Timestamp`
(ms since epoch) and `X-Signature` = base64 DER `ECDSA-P256-SHA256("smartcampus/v1/request\0" ‖ METHOD ‖ "\n" ‖ path ‖ "\n" ‖ timestamp)`,
where `path` has no query string. The server refuses a timestamp more than 60 s off, and only serves an asset to a device that was
sent `audio.play` for it. The device checks the SHA-256 from `audio.play` before caching or playing the file.

## State a door unit reports

`state.report {state}` from a door unit: `{roomStatus: key, announcements: [ids showing], configApplied: bool, screen: "on"|"sleep", volume, offlineSince?}`.
The console draws its live preview from this and from the desired state; none of it is trusted for decisions on the server.
