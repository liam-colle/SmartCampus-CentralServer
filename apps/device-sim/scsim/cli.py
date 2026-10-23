from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

from .api import Api, ApiError
from .crypto import format_fingerprint
from .device import log, run_device
from .state import DeviceIdentity

HERE = Path(__file__).resolve().parent.parent
REPO_ROOT = HERE.parent.parent


def read_server_key(arg: str | None) -> str:
    """Server public key (SPKI base64 or PEM), from a file or given inline. Provisioned, never fetched."""
    candidates = [arg] if arg else [str(REPO_ROOT / "secrets" / "server-key.pub"), "secrets/server-key.pub"]
    for c in candidates:
        if c and Path(c).is_file():
            return Path(c).read_text().strip()
    if arg and len(arg) > 60 and not Path(arg).exists():
        return arg
    raise SystemExit(
        "server public key not found. Start the dev server once (it writes secrets/server-key.pub) "
        "or pass --server-key <file|base64>."
    )


def cmd_enroll(args) -> int:
    state_dir = Path(args.state_dir)
    path = state_dir / f"{args.name}.json"
    if path.exists() and not args.force:
        raise SystemExit(f"{path} exists: this device already has an identity (use --force to start over)")
    ident = DeviceIdentity.create(args.name, args.type, state_dir)
    api = Api(args.server)
    req = api.enroll_request(ident.public_key, args.type, args.name)
    ident.device_id = req["deviceId"]
    ident.save()

    print("\nConnection request sent. An admin must approve it in the console (Devices > Connection requests).")
    print(f"\n    key fingerprint  {format_fingerprint(req['fingerprint'])}")
    print(f"    device id        {req['deviceId']}")
    print(f"\nThe console shows the same fingerprint: compare them before approving.")
    print(f"request expires {req['expiresAt']}; identity saved to {ident.path} (contains the private key)\n")
    if args.no_wait:
        return 0

    print("waiting for the decision...", flush=True)
    deadline = time.time() + args.timeout
    outcome = "timeout"
    while time.time() < deadline:
        outcome = api.enrollment_status(req["deviceId"])
        if outcome != "pending":
            break
        time.sleep(2)
    if outcome == "active":
        print("approved.")
        if args.run:
            return cmd_run(args)
        print(f"Start it with: run --name {args.name}")
        return 0
    messages = {
        "denied": "the request was denied.",
        "expired": "the request expired before anyone answered.",
        "revoked": "the device was revoked.",
        "unknown": "the server no longer knows this request.",
        "timeout": "gave up waiting.",
    }
    print(messages.get(outcome, f"enrollment ended: {outcome}"))
    return 1


def cmd_run(args) -> int:
    ident = DeviceIdentity.load(args.name, Path(args.state_dir))
    server_key = read_server_key(args.server_key)
    try:
        asyncio.run(run_device(args.server, ident, server_key, ack=not args.no_ack, reconnect=not args.once, taps=args.taps))
    except KeyboardInterrupt:
        log("stopped")
    return 0


def cmd_show(args) -> int:
    ident = DeviceIdentity.load(args.name, Path(args.state_dir))
    print(f"name         {ident.name}\ntype         {ident.type}\ndevice id    {ident.device_id}")
    print(f"fingerprint  {format_fingerprint(ident.fingerprint)}\nexecuted ids {len(ident.seen_ids)}")
    return 0


def cmd_selftest(args) -> int:
    from .selftest import run

    return asyncio.run(
        run(args.server, read_server_key(args.server_key), args.admin_email, args.admin_password)
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="sim.py", description="SmartCampus device simulator and protocol test tool")
    p.add_argument("--server", default=os.environ.get("SC_SERVER", "http://localhost:3000"), help="server base URL")
    p.add_argument("--server-key", help="server public key: file or base64 (default: secrets/server-key.pub)")
    p.add_argument("--state-dir", default=str(HERE / ".state"), help="where simulated device identities are kept")
    sub = p.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("enroll", help="generate a key pair, send a connection request and wait for an admin to approve or deny it")
    e.add_argument("--name", required=True)
    e.add_argument("--type", choices=["door", "display", "access"], default="door")
    e.add_argument("--timeout", type=int, default=600, metavar="SECONDS", help="how long to wait for a decision (default 600)")
    e.add_argument("--no-wait", action="store_true", help="send the request and exit")
    e.add_argument("--run", action="store_true", help="once approved, keep going and run as the device")
    e.add_argument("--no-ack", action="store_true", help=argparse.SUPPRESS)
    e.add_argument("--once", action="store_true", help=argparse.SUPPRESS)
    e.add_argument("--taps", action="store_true", help=argparse.SUPPRESS)
    e.add_argument("--force", action="store_true")
    e.set_defaults(fn=cmd_enroll)

    r = sub.add_parser("run", help="connect as an enrolled device and behave like one")
    r.add_argument("--name", required=True)
    r.add_argument("--no-ack", action="store_true", help="never acknowledge commands (to watch the server replay them)")
    r.add_argument("--once", action="store_true", help="do not reconnect when the connection ends")
    r.add_argument("--taps", action="store_true", help="read card serial numbers from stdin, one per line, and present them like a reader")
    r.set_defaults(fn=cmd_run)

    s = sub.add_parser("show", help="show a simulated device identity")
    s.add_argument("--name", required=True)
    s.set_defaults(fn=cmd_show)

    t = sub.add_parser("selftest", help="run the full protocol conformance suite, including attack scenarios")
    t.add_argument("--admin-email", default=os.environ.get("SC_ADMIN_EMAIL", "admin@smartcampus.local"))
    t.add_argument("--admin-password", default=os.environ.get("SC_ADMIN_PASSWORD", "changeme123"))
    t.set_defaults(fn=cmd_selftest)

    args = p.parse_args(argv)
    try:
        return args.fn(args)
    except ApiError as exc:
        print(f"server refused: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"cannot reach {args.server}: {exc}", file=sys.stderr)
        return 1
