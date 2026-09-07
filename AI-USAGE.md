# AI Usage

ETHGlobal requires disclosure of where and how AI tools were used. This file is that
disclosure, kept current as the project is built.

## Tools used

| Tool | Used for |
|---|---|
| Claude Code (Opus 5) | Research, capability mapping, architecture decisions, code generation, this file |

## How it was directed

This project uses a **spec-driven workflow**. Per ETHGlobal's rule, the artifacts that
directed the AI are included in this repository:

- `specs/` — architecture and provenance today; the product spec and build plan land as the
  build proceeds
- `prompts/` — the prompts that shaped the build. **Currently empty apart from its README**;
  files are added as each step happens rather than reconstructed at the end
- commit history — the iterative fix loop, one commit per meaningful change

## Human contribution

- Selected the sponsor, track, and project direction
- Created and funded all Hedera accounts
- Reviewed and approved architecture decisions
- Records the demo video (no AI voiceover — ETHGlobal disqualifies synthesised narration)
- Final judgement on what ships

## Starter code

Built on Hedera's official **`scaffold-hbar`** starter, `templates/x402-pay-per-use` branch
(<https://github.com/hedera-dev/scaffold-hbar>) — permitted under the rules as a public
starter kit. What came from the template versus what is ours is recorded in
`specs/provenance.md`.

## Per-file attribution

Files substantially AI-generated are listed in `specs/provenance.md` alongside their origin
(template / AI-written / human-written), and that table is updated as the build proceeds.
