import { HttpError } from "../lib/errors.js";
import { UserModel, type ProviderId, type UserDoc } from "../models/user.js";

/** Normalised profile every external identity provider must produce. */
export interface ExternalProfile {
  provider: Exclude<ProviderId, "local">;
  /** Stable, provider-unique id (Azure: `oid`). */
  subject: string;
  email: string;
  name: string;
}

/**
 * Maps an external profile to a local user:
 *  1. known identity            -> that user
 *  2. existing user, same email -> link the identity to it
 *  3. otherwise                 -> create one if auto-provisioning is allowed, else reject
 *
 * Step 2 trusts the provider's email, so only enable SSO against a tenant you control.
 */
export async function resolveExternalUser(
  profile: ExternalProfile,
  opts: { autoProvision: boolean },
): Promise<UserDoc> {
  const identity = { provider: profile.provider, subject: profile.subject };
  const email = profile.email.toLowerCase().trim();

  let user = await UserModel.findOne({
    identities: { $elemMatch: identity },
  });

  if (!user) {
    user = await UserModel.findOne({ email });
    if (user) {
      user.identities.push(identity);
      await user.save();
    } else if (opts.autoProvision) {
      user = await UserModel.create({
        email,
        name: profile.name || email,
        role: "staff",
        identities: [identity],
      });
    } else {
      throw new HttpError(403, "No account is registered for this user");
    }
  }

  if (user.disabled) throw new HttpError(403, "Account disabled");
  return user;
}
