---
trigger: always_on
description: SmartCampus-CentralServer project rules
---

# SmartCampus-CentralServer rules

Read `AGENTS.md` at the repository root first: it is the full guideline and the source of truth. The essentials:

## Hard rules

- **No credits.** Never mention yourself, an AI or any tool in commits, PR descriptions, issues, code comments or docs. No `Co-Authored-By` trailers, no "Generated with…" lines.
- **Conventional Commits**: `<type>(<scope>): <subject>`, types `feat fix docs style refactor perf test build ci chore revert`, lowercase imperative subject, ≤ 72 chars, one logical change per commit, `Closes #n` in the footer, `!` + `BREAKING CHANGE:` for breaking changes.
- Do not commit, push, open PRs or create/close issues unless asked. Never commit secrets or `.env`.
- Never log or return passwords, hashes, session tokens or private keys.

## Project

Central server of Smart Campus: Express + TypeScript + MongoDB backend (`backend/`), React + Vite + Tailwind v4 + shadcn/ui console (`frontend/`), **pnpm** everywhere, Docker Compose for dev (`docker-compose.dev.yml`) and prod (`docker-compose.yml`). Design reference: `docs/SmartCampus-CentralServer_Technical_Deck.pdf` (French): WSS gateway for devices (`ws`), mutual handshake with signed session keys (ECDSA P-256, ECDH, HKDF, AES-256-GCM), outbox + idempotent commands, digital-twin state, shared zod protocol package, GridFS assets, Agenda jobs, pino logs.

## Conventions

- Backend: ESM with `.js` import suffixes, config only via `src/config.ts`, zod validation on every input, `HttpError` for failures, thin routers, DTO functions instead of raw documents, authorization enforced server-side (`admin` / `operator` / `staff`).
- Frontend: strict TypeScript, `@/` alias, `lib/api.ts` + `lib/useFetch.ts`, shadcn components, dark only with near-black surfaces and `#00a86b` as foreground/primary via CSS variable tokens, accessible forms.
- Device input is hostile: size-limited, schema-validated, idempotent. Device identity never relies on TLS alone.

## Before saying done

Run `pnpm typecheck` and `pnpm build` in each project you changed and report failures or anything you could not verify.
