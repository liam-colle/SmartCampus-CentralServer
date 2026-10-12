import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  MONGO_URI: z.string().default("mongodb://localhost:27017/smartcampus"),

  // Public URL of the app as the browser sees it (used for the Origin check and SSO redirects).
  APP_URL: z.string().url().default("http://localhost:5173"),
  // Directory with the built frontend. Only served when NODE_ENV=production.
  STATIC_DIR: z.string().default("public"),
  TRUST_PROXY: bool,

  SESSION_COOKIE_NAME: z.string().default("sc_sid"),
  // Hard limit: a session never lives longer than this, however active the user is.
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  // Inactivity limit: the session ends after this long without an authenticated request.
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(30),
  // Set to true when served over HTTPS.
  COOKIE_SECURE: bool,

  // Optional bootstrap admin, created on startup if it does not exist yet.
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(10).optional(),
  SEED_ADMIN_NAME: z.string().default("Administrator"),

  // Outgoing mail (password reset, invitations). Without SMTP_HOST, mails are printed to the log.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("SmartCampus <no-reply@smartcampus.local>"),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().positive().default(60),
  INVITE_TTL_HOURS: z.coerce.number().positive().default(72),

  // Microsoft Azure / Entra ID SSO (not implemented yet, see auth/providers/azure.ts).
  AZURE_ENABLED: bool,
  AZURE_TENANT_ID: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  AZURE_CLIENT_SECRET: z.string().optional(),
  AZURE_REDIRECT_URI: z.string().url().optional(),
  // Create a local user on first SSO login when no matching user exists.
  AZURE_AUTO_PROVISION: bool,
});

// Compose passes unset variables through as empty strings; treat those as missing.
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));

export const config = schema.parse(env);
export const isProd = config.NODE_ENV === "production";
