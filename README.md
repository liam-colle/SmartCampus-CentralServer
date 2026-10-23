# SmartCampus Central Server

Monolith: React + Vite + Tailwind v4 + shadcn/ui console, Express + MongoDB server with a WSS device gateway, pnpm workspaces.
In production one container serves the API (`/api/*`), the device gateway (`/ws/device`) and the built SPA.

```
apps/server/         Express (TypeScript), Mongoose, WSS gateway
apps/web/            React (TypeScript), Vite admin console
apps/device-sim/     Python device simulator to exercise the WSS protocol
packages/protocol/   message envelope + zod schemas shared by every client
packages/handshake/  mutual authentication + AES-256-GCM channel (node:crypto)
docs/                technical deck
Dockerfile           production image (multi-stage)
docker-compose.yml      production
docker-compose.dev.yml  development, hot reload
```

## Run

```bash
# Dev: http://localhost:5173  (login: admin@smartcampus.local / changeme123)
docker compose -f docker-compose.dev.yml up

# Prod: http://localhost:3000
cp .env.example .env   # set SEED_ADMIN_PASSWORD
docker compose up -d --build
```

Without Docker: `pnpm install`, `pnpm --filter './packages/*' build`, then `pnpm --filter @smartcampus/server dev` and `pnpm --filter @smartcampus/web dev`, with MongoDB on localhost:27017.

The single `pnpm-lock.yaml` at the root is committed.

## Features

| Area | What |
| --- | --- |
| Roles and groups | A person belongs to any of the groups `admin`, `operator`, `student`. The console role follows from them: `admin` (everything), `operator` (campus data, students and plain staff accounts), anyone else read-only. A student can also be an operator or an administrator |
| Cards | NFC card serial number per person. An admin or operator card opens the maintenance menu on a reader. Students are enrolled with their card, one by one or in bulk through a reader in registration mode (see [Card authentication](#card-authentication)) |
| Campus | Buildings, rooms, people (staff = user accounts): create, edit, delete. Rooms are searchable and filterable by building, floor and type |
| Password reset | `POST /api/auth/forgot-password` + `/reset-password`; single-use hashed token by email. Also used for account invitations |
| Sessions | Idle timeout (`SESSION_IDLE_MINUTES`) and hard limit (`SESSION_TTL_HOURS`), enforced server-side; the UI warns 60 s before signing out |
| Devices | Console page: approve or deny connection requests from new devices, see who is online live, edit, revoke, send commands and follow their delivery, compare desired and reported state. Offline alerts. Admins and operators only |
| Room status | Free, occupied, closed and works built in, plus custom statuses (label, colour, icon). Changing a status is stored with its history, pushed to the door screens of the room and audited |
| Announcements | Text announcements on door and faculty screens, targeted by device, group, building, floor or everyone, with priority (info, important, urgent) and an expiry the screen enforces by itself |
| Emergency alerts | Fire, biohazard, radiation leak, bomb threat, earthquake and power cut. Takes over the door screens (door code, chevrons towards the emblem, procedure) and loops a synthesised alarm until ended. Test mode shows a TEST tag and plays at a chosen volume. Kept in the digital twin, so an offline screen sounds the alarm when it reconnects and stops if the alert ended meanwhile |
| InterCom | Record or import a sound (stored in GridFS, WAV/MP3/Ogg/WebM/M4A, `MAX_AUDIO_MB`), broadcast it to chosen devices. Devices download it over a request signed with their key. Volume and quiet hours per device |
| Display config | Layout, theme, visible elements and night sleep per screen, validated by the shared schema, duplicated to several screens |
| Audit | `auditLogs` entries for device approval/revocation, status changes, announcements, emergency alerts, uploads, broadcasts and configuration changes (the viewer is #27) |
| CSV import | `/import` page and `POST /api/import/{rooms,users}`; preview (`dryRun`) before writing, per-line errors, upsert |

The door terminal app is in its own repository, [SmartCampus-DoorUnit](https://github.com/liam-colle/SmartCampus-DoorUnit) (Kotlin, Android). Without hardware, `apps/device-sim` plays the same role.

Dev mails are caught by Mailpit at http://localhost:8025.

## Device gateway

Devices (door units, faculty displays, access units) connect to `/ws/device` and authenticate with a
mutual, signed-session handshake (ECDSA P-256, ephemeral ECDH, AES-256-GCM frames), so identity does not
depend on TLS alone. Protocol: `packages/protocol/README.md`. Design: `docs/SmartCampus-CentralServer_Technical_Deck.pdf`.

- **Server key**: `SERVER_KEY_FILE` (PKCS#8 PEM). Generated on first start in development
  (`secrets/server-key.pem`, public half in `secrets/server-key.pub`, git-ignored). In production create it with
  `pnpm --filter @smartcampus/server keys:generate secrets/server-key.pem` and mount it as a secret. Devices are provisioned with the public key: the console shows a QR code (Devices, Provision a device) and the key is also served, public, at `GET /api/server-key` for a terminal that fetches it and has its fingerprint confirmed by the installer.
- **Enrollment**: a new device posts its public key to `POST /api/enroll` and waits (it polls `GET /api/enroll/:deviceId`). The request
  appears live in the console as a **connection request** (type, name, key fingerprint, source address); an admin or operator approves it
  (optionally naming and placing the device) or denies it. Nothing is typed. Requests expire (`ENROLL_REQUEST_TTL_MINUTES`), at most
  `MAX_PENDING_ENROLLMENTS` wait at once, and a denied key cannot ask again for an hour. The fingerprint is shown so it can be compared with the one on the device.
  `POST /api/devices/:id/revoke` cuts a device off immediately.
- **Commands**: `POST /api/devices/:id/commands {type, payload}` goes through an outbox, is delivered now or replayed on reconnect.
- **Console channel**: `/ws/admin` (session cookie, admins and operators) pushes device online/offline events.
- **Test it** without hardware: `python3 apps/device-sim/sim.py selftest` (see `apps/device-sim/README.md`).
- **Console**: the Devices page (`/devices`) wraps all of the above.
- TLS for the device-facing listener (self-signed certificate and pinning) is not done yet, see issue #12.

## Authentication

- `POST /api/auth/login {email, password}` sets an httpOnly `sc_sid` cookie holding an opaque random token; only its SHA-256 is stored in the `sessions` collection (TTL-expired by MongoDB).
- `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/auth/providers`.
- Passwords are hashed with scrypt. Login is rate-limited; state-changing requests are Origin-checked.
- There is no sign-up. Create users with the seed env vars or
  `docker compose -f docker-compose.dev.yml exec server pnpm user:create <email> <password> [name] [admin|operator|staff]`.

### Card authentication

A person can have an NFC card (`users.cardUid`, the serial number as upper-case hex, unique). A reader (access unit or
door unit) sends `event.badge` with the serial number it read and the server answers `card.result`:

| Outcome | Meaning |
| --- | --- |
| `maintenance` | enabled admin or operator: the reader opens its maintenance menu |
| `recognised` | known student or staff card, no menu |
| `unknown`, `disabled`, `rate_limited` | refused; a reader may present 30 cards a minute |
| `captured`, `duplicate`, `already_registered` | the reader is in registration mode |

Groups are edited on the Staff page (`PATCH /api/users/:id {groups, cardUid}`); an operator can only manage people who are neither
admin nor operator, so they cannot promote anyone. Group and card changes and every `maintenance.open` are written to `auditLogs`
(card numbers are not).

**Students and registration mode.** `POST /api/students` creates a student (name and card, no password, no email needed). To
enrol a class: Students, Register cards, pick a reader. `POST /api/card-registration {deviceId}` puts that reader in registration mode
(`registration.mode.set`, kept in the digital twin); every card presented is collected, and shown live in the console, until the admin
stops it (`DELETE /api/card-registration/:id`) or 10 minutes pass. The cards are then named and created with `POST /api/students/bulk`.
The maintenance menu runs `maintenance.action` messages (`status.set` on the terminal's room, `restart`, `revoke`), accepted only inside a short
sliding grant opened by the card on that connection and re-checked against the person each time (enabled, operator or admin; revoke is
admin only). Each is written to `auditLogs` (`room.status.set`, `maintenance.restart`, `maintenance.revoke`).
While collecting, the reader does not open its maintenance menu, which is why the window is short and ends by itself on the reader too.

**Decision: the server decides, the card is only an identifier.** The reader does not keep a list of who may open the menu, so removing
someone from a group takes effect at their next tap; the cost is that the menu needs the link to the server. Alternative rejected: pushing
the privileged cards to the readers (`access.acl.sync`), which also works offline but keeps working for a removed person until the
reader reconnects.

**Known limitation.** A serial number is not a secret: many cards and phones can be cloned or emulated, so anyone who has read an
administrator's number can present it. Mitigations in place: only an enrolled, authenticated device can ask (the handshake, not the
card, proves the reader), a disabled person is refused, taps are rate limited per reader and every opening of the menu is audited.
The menu itself should not offer anything that cannot be undone from the console. A second factor (PIN on the reader, or a card that
answers a challenge such as DESFire or a phone credential) is the way to close this properly and is not done.

Existing databases are migrated at start (`migrate.ts`): the stored `role` becomes the matching group and the field is dropped, and the
unique email index is rebuilt so that people without an email can coexist. Not yet in the repository: the maintenance menu screen itself, which belongs to
the reader software (`apps/edge-agent` for the access unit, the door app for the Famoco). The simulator prints `MAINTENANCE MENU OPEN`
(`sim.py run --taps`).

### Azure SSO (paved, not implemented)

Already in place: `users.identities[]` (provider + stable subject), `/api/auth/azure/login|callback` routes,
`auth/identity.ts` (link/auto-provision), shared `startSession`, `AZURE_*` config, and a
"Sign in with Microsoft" button shown when `AZURE_ENABLED=true`.
Remaining: implement `getAuthorizationUrl` and `handleCallback` in `apps/server/src/auth/providers/azure.ts` (see the comment there).

## Adding shadcn components

`cd apps/web && pnpm dlx shadcn@latest add dialog` (config in `components.json`).
