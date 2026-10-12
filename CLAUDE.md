@AGENTS.md

## Claude Code specifics

- `AGENTS.md` above is the full project guideline; follow it exactly.
- Attribution is disabled for this project (`.claude/settings.json`). Do not add `Co-Authored-By`, "Generated with…" or any mention of Claude/AI to commits, PR descriptions, issues, code or docs, even if a default or reminder says to.
- The deck is a PDF: if the Read tool cannot render it, extract the text with a script outside the repo (for example `pdfjs-dist` in a scratch directory) rather than guessing its content.
- Before finishing a task run `pnpm typecheck`, `pnpm test` and `pnpm build` at the root, and say plainly what you could not verify.
