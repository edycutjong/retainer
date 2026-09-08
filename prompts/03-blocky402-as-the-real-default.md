# 03 — Audit the first commit against itself

**Commit produced:** `8243c11` — *Fix: make Blocky402 the actual default, not just a claim*
**When:** 2026-09-07 17:35 +07

## The direction given

Audit the initial commit as an outsider would: clone it fresh, with no local `.env`, and check
that every claim made in a tracked file is true of the tracked files.

Where a claim and the code disagree, change the code, then record the correction in
`specs/provenance.md` **as a correction** — do not quietly edit the earlier sentence into
being true. A provenance file that overstates what changed is worse than no provenance file.

Also, while auditing: no credential may live in the tree.

## Why it was given then

The commit message of `4a0ddc3` announced a facilitator change. The audit found the change had
only ever been made in a local, gitignored `.env`. Every tracked file — the code default in
`services/x402/server.ts`, `.env.example`, the README, the RUNBOOK — still pointed at the
template's self-hosted `localhost:4020`. A judge cloning the repo would have run against the
wrong facilitator, which the bounty does not permit.

Catching that at commit two rather than at submission is the entire value of the pass. The
repo is public during the event and its history is judged, so there is no later sanitising
step in which this could have been fixed invisibly.

## What the commit changed

- `packages/nextjs/services/x402/server.ts` — code default is now
  `https://api.testnet.blocky402.com`
- `packages/nextjs/.env.example` — same default, so the documented path matches the code
- `README.md`, `RUNBOOK.md` — Blocky402 is the default; self-hosted is demoted to a local
  fallback (the template presented the opposite)
- `RUNBOOK.md` — removed the section explaining how to republish this repo as a
  `create-scaffold-hbar` template branch, which is meaningless here
- deleted `template.json`, the CLI template manifest
- `specs/provenance.md` — a dated *Correction* section logging the overstatement
- `AI-USAGE.md`, `prompts/README.md` — state plainly that `prompts/` was still empty at that
  point, rather than implying a record existed
- `packages/hardhat/.env` no longer holds the deployer key; `hardhat.config.ts` reads
  `__RUNTIME_DEPLOYER_PRIVATE_KEY` at runtime, passed in from outside the tree
