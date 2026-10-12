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
| Devices | Console page to enroll devices (code + fingerprint), see who is online live, edit, revoke, send commands and follow their delivery, compare desired and reported state. Offline alerts. Admins and operators only |
| CSV import | `/import` page and `POST /api/import/{rooms,users}`; preview (`dryRun`) before writing, per-line errors, upsert |

Dev mails are caught by Mailpit at http://localhost:8025.

## Device gateway

Devices (door units, faculty displays, access units) connect to `/ws/device` and authenticate with a
mutual, signed-session handshake (ECDSA P-256, ephemeral ECDH, AES-256-GCM frames), so identity does not
depend on TLS alone. Protocol: `packages/protocol/README.md`. Design: `docs/SmartCampus-CentralServer_Technical_Deck.pdf`.

- **Server key**: `SERVER_KEY_FILE` (PKCS#8 PEM). Generated on first start in development
  (`secrets/server-key.pem`, public half in `secrets/server-key.pub`, git-ignored). In production create it with
  `pnpm --filter @smartcampus/server keys:generate secrets/server-key.pem` and mount it as a secret. Devices are provisioned with the public key.
- **Enrollment**: the device posts its public key to `POST /api/enroll`, shows the returned code and fingerprint, and an admin
  confirms them with `POST /api/devices/enroll`. `POST /api/devices/:id/revoke` cuts a device off immediately.
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
