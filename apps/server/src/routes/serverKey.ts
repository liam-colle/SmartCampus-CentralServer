import { fingerprint } from "@smartcampus/handshake";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.js";

/**
 * Public: tells a terminal that is being set up which key this server proves with its handshake.
 * The key is public by nature. It is only a convenience for the first connection (the installer
 * confirms the fingerprint, or scans the QR code from the console, which carries the same key);
 * after that the terminal pins the key and never asks again.
 */
export function serverKeyRouter(serverPublicKey: string) {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: config.ENROLL_RATE_LIMIT,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests, try again later" },
    }),
  );
  const info = { publicKey: serverPublicKey, fingerprint: fingerprint(serverPublicKey) };
  router.get("/", (_req, res) => {
    res.json(info);
  });
  return router;
}
