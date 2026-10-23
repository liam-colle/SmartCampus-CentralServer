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
| Roles | `admin` (everything), `operator` (campus data + staff accounts), `staff` (read-only campus data) |
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
  `pnpm --filter @smartcampus/server keys:generate secrets/server-key.pem` and mount it as a secret. Devices are provisioned with the public key.
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

### Azure SSO (paved, not implemented)

Already in place: `users.identities[]` (provider + stable subject), `/api/auth/azure/login|callback` routes,
`auth/identity.ts` (link/auto-provision), shared `startSession`, `AZURE_*` config, and a
"Sign in with Microsoft" button shown when `AZURE_ENABLED=true`.
Remaining: implement `getAuthorizationUrl` and `handleCallback` in `apps/server/src/auth/providers/azure.ts` (see the comment there).

## Adding shadcn components

`cd apps/web && pnpm dlx shadcn@latest add dialog` (config in `components.json`).
