import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { attachUser, sameOriginGuard } from "./auth/middleware.js";
import { config, isProd } from "./config.js";
import { HttpError } from "./lib/errors.js";
import { authRouter } from "./routes/auth.js";

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
      res.status(400).json({ error: "Invalid request", details: err.flatten().fieldErrors });
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
