import type { Request, Response } from "express";
import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import type { ExternalProfile } from "../identity.js";

/**
 * Microsoft Azure / Entra ID SSO — scaffold only.
 *
 * Everything around it is wired: the routes (routes/auth.ts), the identity linking
 * (auth/identity.ts), the session creation and the "Sign in with Microsoft" button.
 * To finish it, implement the two methods below (e.g. with `@azure/msal-node`):
 *
 *  1. getAuthorizationUrl: authorization code flow with PKCE. Generate `state`, `nonce` and a
 *     PKCE verifier, keep them in a short-lived signed httpOnly cookie, return the authorize URL.
 *  2. handleCallback: validate `state`, exchange `code` for tokens, validate the ID token
 *     (issuer, audience, nonce) and map its claims to an ExternalProfile (`oid`, email, name).
 *
 * Env: AZURE_ENABLED, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_REDIRECT_URI
 * (register <APP_URL>/api/auth/azure/callback as a Web redirect URI in the app registration).
 */
export const azureProvider = {
  id: "azure" as const,

  get enabled(): boolean {
    return config.AZURE_ENABLED;
  },

  assertEnabled(): void {
    if (!config.AZURE_ENABLED) throw new HttpError(404, "Azure SSO is not enabled");
    if (!config.AZURE_TENANT_ID || !config.AZURE_CLIENT_ID) {
      throw new HttpError(500, "Azure SSO is enabled but AZURE_TENANT_ID / AZURE_CLIENT_ID are missing");
    }
  },

  async getAuthorizationUrl(_req: Request, _res: Response): Promise<string> {
    this.assertEnabled();
    throw new HttpError(501, "Azure SSO is not implemented yet");
  },

  async handleCallback(_req: Request, _res: Response): Promise<ExternalProfile> {
    this.assertEnabled();
    throw new HttpError(501, "Azure SSO is not implemented yet");
  },
};
