import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

export const ROLES = ["admin", "user"] as const;
export type Role = (typeof ROLES)[number];

/** Ways a user can sign in. `local` = email + password, others are external identity providers. */
export const PROVIDERS = [
  "local",
  "azure"
] as const;
export type ProviderId = (typeof PROVIDERS)[number];

const identitySchema = new Schema(
  {
    provider: { type: String, enum: PROVIDERS, required: true },
    // Stable id from the provider (for Azure: the `oid` or `sub` claim), never the email.
    subject: { type: String, required: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ROLES, default: "user", required: true },
    // Absent for users that only sign in through SSO.
    passwordHash: { type: String },
    identities: { type: [identitySchema], default: [] },
    disabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

userSchema.index(
  { "identities.provider": 1, "identities.subject": 1 },
  { unique: true, partialFilterExpression: { "identities.0": { $exists: true } } },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const UserModel = model("User", userSchema);

/** What the API exposes to clients. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export function toPublicUser(user: UserDoc): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
