# Device simulator and protocol test tool

A Python implementation of the **device side** of the SmartCampus WSS protocol. It exists to exercise
the server without hardware, and as an independent second implementation of the protocol: if Python
and the Node gateway interoperate, the specification in `packages/protocol` and `packages/handshake`
is precise enough for the Famoco app and the edge agent.

```bash
pip install -r apps/device-sim/requirements.txt     # cryptography, websockets (Python 3.11+)
python3 apps/device-sim/sim.py --help
```

The server must be running (`docker compose -f docker-compose.dev.yml up`). The simulator needs the
server's **public** key, which is provisioned on devices and never fetched from the network: the dev
server writes it to `secrets/server-key.pub` on first start (or use `--server-key <file|base64>`).

## Commands

| Command | What it does |
| --- | --- |
| `enroll --name door-1 [--type door\|display\|access] [--wait 120]` | Generates an ECDSA P-256 key pair, requests enrollment and prints the one-time **code** and the key **fingerprint**. An admin confirms both (console API `POST /api/devices/enroll`). `--wait` polls until approved. |
| `run --name door-1 [--no-ack] [--once]` | Connects, performs the handshake and behaves like a door unit: prints and applies commands, ignores duplicate ids, acknowledges, reports state, reconnects with 1 to 60 s jittered backoff. `--no-ack` withholds acknowledgements so you can watch the server replay. |
| `show --name door-1` | Prints the saved identity (id, fingerprint). |
| `selftest` | Runs the full conformance suite (below) against the live server and exits non-zero on failure. |

Identities are stored in `apps/device-sim/.state/<name>.json` (git-ignored, mode 0600, contains the private key).
Defaults: `--server http://localhost:3000`, admin `admin@smartcampus.local` / `changeme123` (the dev seed);
override with `--admin-email/--admin-password` or `SC_SERVER`, `SC_ADMIN_EMAIL`, `SC_ADMIN_PASSWORD`.

## Manual walkthrough

```bash
python3 apps/device-sim/sim.py enroll --name door-1 --wait 300
#  -> prints code and fingerprint; approve with the console API:
#  curl -b cookies -H 'Content-Type: application/json' localhost:3000/api/devices/enroll \
#       -d '{"code":"...","fingerprint":"...","name":"Door B2-104"}'
python3 apps/device-sim/sim.py run --name door-1
#  in another terminal, as an admin: POST /api/devices/<id>/commands
#  {"type":"room.status.set","payload":{"roomId":"B2-104","status":"occupied"}}
```

## What `selftest` checks

Run it against a dev server (the dev compose file raises `ENROLL_RATE_LIMIT` for this; the suite
enrolls about 25 devices). It takes about 25 seconds, most of it waiting for server timeouts.

- **Enrollment**: code and fingerprint confirmation, single-use codes.
- **Handshake**: mutual authentication, encrypted `session.ready` with `seq` 1.
- **Delivery**: online delivery and ack, outbox replay after reconnect with original ids (acknowledged commands are not resent), desired state on connect, reported state stored, invalid commands refused.
- **Connections**: a new connection replaces the old one (4409), revocation closes the socket (4403) and blocks reconnection.
- **Hostile behaviour**, all of which must be refused: pending, unknown or wrong-key devices (always 4401, the same answer); garbage or silent clients (4400 / 4408); plaintext, tampered, replayed, out-of-order, schema-violating, wrong-direction and oversized frames; acknowledging another device's command; a **relay** that alters the server's ephemeral key (the device aborts and never sends `auth`); a device provisioned with another server key.

Missed-pong handling cannot be driven from here (the Python WebSocket library always answers pings); it is covered by the server's own integration tests (`pnpm --filter @smartcampus/server test`).
