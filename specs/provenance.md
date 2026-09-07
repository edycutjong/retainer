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

## Configuration changes to the template
| Change | Why |
|---|---|
| `FACILITATOR_URL` → `https://api.testnet.blocky402.com` | The bounty requires settlement **through the Blocky402 facilitator**. The template ships a *self-hosted* facilitator, which does not satisfy that requirement. |

*Updated as the build proceeds.*
