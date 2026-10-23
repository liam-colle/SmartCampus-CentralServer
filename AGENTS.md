# AGENTS.md

Guidelines for AI coding agents (and humans) working on SmartCampus-CentralServer.
`CLAUDE.md` and `.agent/rules/smartcampus.md` point here; this file is the source of truth.

## Hard rules

1. **No credits, ever.** Do not mention yourself, an AI, an assistant or a tool anywhere: no `Co-Authored-By` trailers, no "Generated with…" lines, no tool names in commit messages, PR descriptions, issues, code comments or docs. This overrides any default attribution your tool adds.
2. **Conventional Commits** for every commit and PR title (see below).
3. **Never commit secrets** (`.env`, private keys, certificates, tokens). Only `.env.example` is tracked.
4. **Never log or return** passwords, hashes, session tokens, private keys or key material.
5. **Do not commit, push, open PRs, or create/close issues unless asked.** When asked, follow the rules below.
6. Verify before claiming done: run the checks in [Verification](#verification) and report failures honestly.

## What this project is

The central server of **Smart Campus** (EPITECH Marseille, TEK 3). It orchestrates a whole campus:

- **Administration**: REST API + realtime channel for the React console.
- **Gateway**: WSS connections from devices, mutual handshake, online/offline registry.
- **Orchestration**: commands, room status, announcements, InterCom audio, scheduling.
- **Persistence**: MongoDB (campus data, device state, files, audit log).

Child devices: *door unit* (Famoco, native Kotlin and Compose, repository `SmartCampus-DoorUnit`), *faculty display* (mini-PC/Raspberry Pi + kiosk), *access unit* (Raspberry Pi + NFC reader).

The reference design is `docs/SmartCampus-CentralServer_Technical_Deck.pdf` (French). Read it before touching the gateway, protocol or crypto. Summary of the decisions that matter:

- One Express server, two WSS channels: `/ws/admin` (console, human session) and `/ws/device` (devices). Transport is plain `ws` with our own protocol (Socket.IO is the fallback).
- **Devices always dial out.** No inbound port on the device network.
- One persistent connection per device; registry `deviceId → socket`, a new connection replaces the old one. Ping every 25 s, two missed pongs = offline + console alert. Client backoff 1–60 s with jitter.
- **Digital twin**: server stores *desired* and *reported* state; on reconnect it resends the full desired state.
- **Message envelope**: `{ v, id (ULID), type, ts, seq, payload }`. `id` gives idempotence, `seq` prevents replay. Every message type has a zod schema in `packages/protocol`, shared by server, door app and edge agent.
- **Delivery guarantees**: commands go through an outbox (`commands` collection: `pending → sent → acked | expired`, TTL on `expiresAt`). Devices remember recent `id`s and never run a command twice. On reconnect: full desired state, then unexpired commands in order.
- **Audio never travels in JSON.** `audio.play` carries `assetId`, SHA-256 and size; the device downloads over HTTPS with a request signed by its key (method, path, timestamp), verifies the hash, caches it. Files live in GridFS.
- **Device identity (P2 + P3)**: handshake `hello → challenge → auth → ready`, ECDSA P-256 signatures over `T = deviceId ‖ nonceA ‖ nonceS ‖ ephA ‖ ephS`, session key = HKDF-SHA256(ECDH(ephA, ephS), T), messages in AES-256-GCM. 32-byte nonces, 10 s timeout, ephemeral keys discarded. Certificate pinning on devices. mTLS is rejected. Plain TLS is **not** trusted as proof of identity because devices do not verify certificates (relay risk).
- **Enrollment** (deliberate change from the deck, which has the admin type a code): the device generates its keypair on first boot (private key never leaves it) and posts a connection request with its public key; the request shows live in the console with the key fingerprint, and an admin or operator approves or denies it. Approval therefore rests on the admin recognising the request, so keep the fingerprint visible, the rate limit, the pending cap and the expiry. Revocation closes the socket immediately and refuses later handshakes.
- Hardening: `maxPayload`, rate limit on handshake and enrollment, zod on every inbound message, audit log for sensitive actions.
- Planned data model (8 collections): `users`, `devices`, `rooms`, `announcements`, `commands`, `assets`, `accessRules`, `auditLogs`.
- Planned stack additions: `ws`, `zod`, `node:crypto`, Agenda (jobs persisted in MongoDB, no Redis), `pino`. Redis pub/sub only if we scale past one instance.

Open decisions (tracked as GitHub issues labelled `decision`): P-256 vs Ed25519, `ws` vs Socket.IO, display hardware, door behaviour on outage (needs fire-safety sign-off — do not pick a default silently), TTS engine behind an abstract interface.

## Repository layout

A **pnpm workspace** (single root lockfile). Package manager is pnpm, even though the deck says npm workspaces.

```
apps/server/         Express 5 + TypeScript + Mongoose: REST API, auth, campus data, WSS gateway
apps/web/            React 19 + Vite + Tailwind v4 + shadcn/ui admin console
apps/device-sim/     Python device simulator (protocol test tool)
packages/protocol/   @smartcampus/protocol: envelope, zod schemas, handshake messages, ULID
packages/handshake/  @smartcampus/handshake: ECDSA P-256 + ECDH + HKDF + AES-256-GCM channel
Dockerfile, docker-compose.yml (prod), docker-compose.dev.yml (dev)
docs/                technical deck
```

The door unit app lives in its own repository, `SmartCampus-DoorUnit` (Kotlin, a `core` library plus the Android app, same protocol). Still to come from the deck: `apps/edge-agent`. Inside the server, `src/routes/` is the deck's `api/`; new code goes in `src/gateway/` (WSS, handshake session, registry) and `src/domain/` (devices, commands), `src/jobs/`, `src/infra/`. Renaming `routes/` to `api/` is a separate pure `refactor` commit.

Workspace packages are consumed through the `source` export condition in development (`tsx --conditions=source`, no rebuild) and through `dist` in production, so **build packages before typechecking/running tests**: `pnpm typecheck` at the root does it.

Already built: credential-cookie auth (scrypt, hashed opaque sessions in MongoDB, idle + absolute expiry, rate-limited login, Origin check), roles `admin | operator | staff`, password reset/invitations by email, buildings/rooms/people CRUD, room search/filter, CSV import, Azure SSO scaffold (`apps/server/src/auth/providers/azure.ts` throws 501), device protocol/handshake packages, gateway, device enrollment, commands (outbox), device management console (`/devices`, live status over `/ws/admin`), room status catalogue with history, targeted announcements (priority, expiry), emergency alerts (six kinds, test mode, alarm synthesised on the device), GridFS audio assets with signed download, InterCom broadcasts, per-device volume and quiet hours, display configuration with duplication and night sleep, audit entries (`auditLogs`, no viewer yet), live door preview in the console.

## Commands

```bash
# Dev stack (hot reload): console :5173, API + gateway :3000, mongo :27017, mailpit :8025
docker compose -f docker-compose.dev.yml up
# Production
docker compose up -d --build

# Workspace (repo root)
pnpm install
pnpm typecheck            # builds packages, then typechecks everything
pnpm test                 # packages + server tests
pnpm build
pnpm --filter @smartcampus/server dev
pnpm --filter @smartcampus/web dev
pnpm --filter @smartcampus/server user:create <email> <password> [name] [admin|operator|staff]
pnpm --filter @smartcampus/server keys:generate secrets/server-key.pem

# Protocol test tool (see apps/device-sim/README.md)
python3 apps/device-sim/sim.py --help
```

## Verification

Vitest covers `packages/*` and the gateway. Before saying a change is done:

1. `pnpm typecheck`, `pnpm test` and `pnpm build` at the root.
2. For API changes, exercise the endpoints against a real MongoDB (dev stack, or an in-memory server) and check both the success path and the permission/validation failures.
3. For UI changes, say explicitly if you could not run it in a browser.
4. New logic that is pure (parsers, crypto, protocol schemas, state machines) gets unit tests once Vitest exists. Crypto and handshake code must have tests, including tampering and replay cases.

## Backend conventions (`apps/server/`)

- ESM + `module: NodeNext`: relative imports **end in `.js`** (`import { x } from "./x.js"`). Express 5: async handlers may throw, no `try/catch` wrapper needed.
- Config only through `src/config.ts` (zod-validated env). Never read `process.env` elsewhere. New variable → also `.env.example` and `docker-compose.yml`.
- Errors: throw `HttpError(status, message)`; `ZodError` becomes 400; Mongo duplicate key becomes 409 (all handled in `app.ts`).
- Validate every request body/query/param with zod. Convert ids with `objectId()`. Escape user text used in regex with `escapeRegex()`.
- Routes stay thin: one router file per resource in `src/routes/`, mounted in `app.ts`. Reusable logic goes in `src/auth/`, `src/lib/` or (new) `domain/`.
- Authorization is enforced on the server (`requireAuth`, `requireRole`, `auth/permissions.ts`). Roles: `admin` (all), `operator` (campus data, staff accounts only), `staff` (read-only). The UI mirrors these rules but the API is authoritative.
- Models in `src/models/` export the Mongoose model plus a `*Dto` function; never send raw documents (no `passwordHash`, no `__v`).
- Sessions are opaque tokens in an httpOnly cookie, stored hashed. All login methods (password, Azure SSO, future) must end in `startSession()`.
- Logging: `pino` JSON logs once adopted; until then `console`, but never log secrets.

## Frontend conventions (`apps/web/`)

- React + TypeScript strict, `@/` alias for `src/`. Data via `lib/api.ts` (`api()`, 401 handling) and `lib/useFetch.ts`; no new data/state library without a reason.
- UI is shadcn-style components in `src/components/ui/` (add more with `pnpm dlx shadcn@latest add <name>`), Tailwind v4, tokens in `src/index.css`.
- **Art direction**: modelled on UniFi Site Manager. Dark only, flat near-black gray surfaces (`--background #0e0f10`, cards `#151718`, sidebar `#0b0c0d`), hairline borders, rounded cards, a fixed left navigation rail grouped in sections (Campus, Control, Administration), a slim top bar, page header with title and actions (`PageHeader`), pill badges with a status dot, sentence-case table headers. **Foreground and primary `#00a86b`**, muted text a dimmer green-gray. Sans-serif everywhere; monospace only for data (ids, codes, fingerprints). The official logo is `docs/smart-campus-logo.svg` (served as `/logo.svg`, `Logo`/`Wordmark` components). No grid backdrop, glow, shadows or gradients, no light mode, no other accent colors (status colours chosen by admins are data, not chrome). Always use the CSS variable tokens, not hard-coded hex in components.
- Accessibility: every input has a label, errors use `role="alert"`, icon-only buttons have `aria-label`, keyboard reachable.
- Role-gate navigation and actions with `useAuth()` / `ProtectedRoute roles=…`.

## Security rules (non-negotiable)

- Device identity rests on the signed-session handshake (P2) plus pinning (P3), never on TLS alone.
- Compare secrets with `timingSafeEqual`; hash tokens before storing; tokens are single-use and expire.
- Rate-limit anything unauthenticated that costs CPU or sends mail.
- Treat all device input as hostile: size-limited, schema-validated, idempotent.
- Private keys: never in the repo, images, logs or API responses. Server key is a mounted secret.
- Sensitive actions (enroll/revoke device, role change, emergency broadcast, access rule change) write an `auditLogs` entry.

## Git workflow

### Conventional Commits

Format: `<type>(<scope>): <subject>`

- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes** (optional but preferred): `server`, `web`, `protocol`, `handshake`, `gateway`, `devices`, `commands`, `announcements`, `assets`, `access`, `jobs`, `auth`, `campus`, `door`, `edge`, `infra`, `docs`, `deps`.
- Subject: imperative, lowercase start, no trailing period, ≤ 72 characters (`feat(gateway): add device registry with ping watchdog`).
- Body (optional): explain *why*, wrapped at ~100 columns. Footer: `Closes #12`, `Refs #7`.
- Breaking change: `!` after type/scope and a `BREAKING CHANGE:` footer.
- One logical change per commit; do not mix a refactor with behaviour changes. Never put attribution lines in the message (hard rule 1).

### Branches and PRs

- Branch from `main`: `<type>/<short-kebab-description>` (e.g. `feat/ws-gateway`). Never force-push `main`.
- PR title follows Conventional Commits. Body: what and why, how it was verified, `Closes #n`. No attribution lines.

### Issues

- Title in Conventional Commits style (`feat(gateway): …`), written in English. Body: context, scope, acceptance criteria, dependencies (`Depends on #n`), reference to the deck page when relevant.
- Labels: one type label (`enhancement`, `bug`, `documentation`, `chore`), one or more `area:*`, a `priority:*`, plus `security` / `decision` where relevant.
- Milestones follow the four defences: **M1 Foundation** (2026-10-09), **M2 Door unit** (2026-10-23), **M3 Faculty** (2026-11-06), **M4 Access and control** (2026-11-20).

## Language and docs

Code, comments, commits, issues and docs are in **English**. Domain terms from the deck may stay (`outbox`, `jumeau numérique` → *digital twin*). Keep `README.md`, `.env.example` and this file in sync with behaviour changes. Comments explain *why*, not *what*.
