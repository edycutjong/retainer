# 02 — Spike the facilitator before building anything on top of it

**Commit produced:** `4a0ddc3` — *Initial commit: x402 pay-per-use scaffold on Hedera testnet*
**When:** 2026-09-07 17:16 +07

## The direction given

Before writing a line of product code, settle the one risk that can make the whole project
ineligible: **does the required facilitator actually work with the client we are going to use?**

Two specific things to establish, in this order:

1. **Read the official starter honestly.** Hedera's bounty page lists
   `hedera-dev/scaffold-hbar`, branch `templates/x402-pay-per-use`, as its starter template.
   Use it — and disclose it openly in the repo, because a starter kit is permitted and hiding
   one reads far worse than naming it. Record what came from the template versus what is ours
   in a provenance file, and keep that file current rather than writing it once at the end.
2. **Check the facilitator the template ships against the facilitator the bounty requires.**
   The template self-hosts its own facilitator. The bounty requires settlement through
   Blocky402. Do not assume the two are interchangeable — call the hosted endpoint and confirm
   it speaks the routes the template's `HTTPFacilitatorClient` expects (`GET /supported`,
   `POST /verify`, `POST /settle`). If the shapes differ, an adapter is needed and that is a
   day-one problem, not a day-three one.

Also: strip the template's assistant-configuration files (`AGENTS.md`, `CLAUDE.md`,
`.claude/`, `.agents/`) on the way in, and write the two documents ETHGlobal's rules require
from the start — `AI-USAGE.md` and this `prompts/` record — rather than retrofitting them.

## Why it was given then

If Blocky402 had turned out to be incompatible, every architectural choice downstream would
have needed rework, and the bounty's first gate would have been unmet no matter how good the
contract was. It is the cheapest possible thing to check and the most expensive thing to
discover late.

## What came back

`GET /supported` on `https://api.testnet.blocky402.com` advertises `hedera:testnet`, scheme
`exact`, `x402Version` 2, and supplies its own fee payer. Drop-in compatible: no adapter, and
no locally run facilitator needed at all.

## What the commit contains

The template imported as the initial commit, plus:

- `specs/architecture.md` — what Retainer is and why each Hedera piece is load-bearing
- `specs/provenance.md` — template versus ours, to be kept current
- `AI-USAGE.md` — the AI tool disclosure ETHGlobal requires
- `prompts/README.md` — the scope of this record

The commit message states the facilitator change as a configuration change from the template.
Step 03 is about the fact that, at this commit, that statement was not yet true of any tracked
file.
