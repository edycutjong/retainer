# Provenance — what came from where

Kept current so the origin of every part of this repository is clear.

## From the template
Hedera's official `scaffold-hbar`, branch `templates/x402-pay-per-use`
(<https://github.com/hedera-dev/scaffold-hbar>). Permitted as a public starter kit.

Everything in the initial commit except the files listed below came from that template,
with these removals for house rules:
- `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/` — assistant-config files, removed

## Ours (written for this project)
| File | Origin |
|---|---|
| `AI-USAGE.md` | AI-written, human-reviewed |
| `prompts/README.md` | AI-written, human-reviewed |
| `specs/provenance.md` | AI-written, human-reviewed |
| `specs/architecture.md` | AI-written, human-reviewed |

## Changes to the template (in tracked files)

| Change | File | Why |
|---|---|---|
| Facilitator default → hosted Blocky402 | `packages/nextjs/services/x402/server.ts` | Settlement must go through Blocky402. Making it the **code default** means a fresh clone uses the correct rail with no extra configuration. |
| Same default in the example env | `packages/nextjs/.env.example` | So the documented setup path matches the code. |
| Facilitator documented as default, self-hosted demoted to local fallback | `README.md`, `RUNBOOK.md` | The template presented self-hosted as the default and Blocky402 as optional — the opposite of the requirement. |
| Removed republish-as-template instructions | `RUNBOOK.md` | The section explained how to push this repo back as a `create-scaffold-hbar` template branch. Meaningless here. |
| Deleted `template.json` | — | The `create-scaffold-hbar` CLI manifest; only meaningful while this repo *is* the template. |
| Removed `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/` | — | Assistant-config files. |

### Correction, 2026-09-07
An earlier version of this file claimed the facilitator change was already made. **It was
not** — at that point Blocky402 existed only in a local, gitignored `.env`, while every
tracked file still defaulted to the self-hosted `localhost:4020`. Anyone cloning the repo
would have used the wrong facilitator. Found by an audit pass; corrected in the tracked tree
above. Recorded here rather than quietly fixed, because a provenance file that overstates
what changed is worse than none.

*Updated as the build proceeds.*
