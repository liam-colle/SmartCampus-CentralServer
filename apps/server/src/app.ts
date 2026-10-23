import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { attachUser, sameOriginGuard } from "./auth/middleware.js";
import { config, isProd } from "./config.js";
import { HttpError } from "./lib/errors.js";
import { announcementsRouter } from "./routes/announcements.js";
import { assetsRouter } from "./routes/assets.js";
import { authRouter } from "./routes/auth.js";
import { buildingsRouter } from "./routes/buildings.js";
import { devicesRouter, enrollRouter } from "./routes/devices.js";
import { emergenciesRouter } from "./routes/emergencies.js";
import { importRouter } from "./routes/import.js";
import { intercomRouter } from "./routes/intercom.js";
import { roomStatusesRouter } from "./routes/roomStatuses.js";
import { roomsRouter } from "./routes/rooms.js";
import { usersRouter } from "./routes/users.js";

const isBodyParserError = (err: unknown): err is { status: number } =>
  typeof err === "object" && err !== null && "type" in err && typeof (err as { type: unknown }).type === "string" &&
  String((err as { type: string }).type).startsWith("entity.") && typeof (err as { status?: unknown }).status === "number";

export function createApp() {
  const app = express();

  if (config.TRUST_PROXY) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        // Don't force https for plain-http deployments (e.g. localhost).
        directives: { "upgrade-insecure-requests": null },
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // --- API ---
  const api = express.Router();
  api.use(sameOriginGuard);
  api.use(attachUser);

  api.get("/health", (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? "ok" : "degraded", db: dbUp });
  });
  api.use("/auth", authRouter);
  api.use("/enroll", enrollRouter);
  api.use("/devices", devicesRouter);
  api.use("/buildings", buildingsRouter);
  api.use("/announcements", announcementsRouter);
  api.use("/assets", assetsRouter);
  api.use("/emergencies", emergenciesRouter);
  api.use("/intercom", intercomRouter);
  api.use("/rooms", roomsRouter);
  api.use("/room-statuses", roomStatusesRouter);
  api.use("/users", usersRouter);
  api.use("/import", importRouter);
  api.use((_req, _res, next) => next(new HttpError(404, "Not found")));

  app.use("/api", api);

  // --- Frontend (production: the built SPA is served by this same process) ---
  if (isProd) {
    const staticDir = path.resolve(config.STATIC_DIR);
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.join(".");
      res.status(400).json({
        error: first ? `${where ? where + ": " : ""}${first.message}` : "Invalid request",
        details: err.flatten().fieldErrors,
      });
    } else if (typeof err === "object" && err && "code" in err && err.code === 11000) {
      res.status(409).json({ error: "An entry with the same unique value already exists" });
    } else if (isBodyParserError(err)) {
      // Why: body-parser throws http-errors (e.g. 413 for an oversized upload) that must not turn into a 500.
      res.status(err.status).json({ error: err.status === 413 ? "The request body is too large" : "Invalid request body" });
    } else if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
  app.use(onError);

  return app;
}
