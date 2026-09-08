# 10 — Delete the template's product; ship Retainer's own surface

**Commit produced:** `c939840` — *Remove the template's product and put Retainer's own surface in its place*
**When:** 2026-09-08 07:25 +07

## The direction given

Open the running app as a judge who has read nothing, and describe what is on screen.

The answer was: a MinIO-backed pay-per-download **file marketplace** — the starter template's
product, not ours — with its one feature in an error state, because the storage backend it needs
was never configured. `FileRegistry`, the block explorer, the upload and download pages, the
docker-compose stack, and a self-hosted facilitator that directly contradicts the Blocky402
requirement this project actually meets were all still shipping.

Delete all of it. Then build the surface the project is about: **watch an access window count
down, and then not go dark.** Show renewals as they are observed, with HashScan links to the
contract and to the pending schedule, so the claim is checkable on someone else's infrastructure
rather than on our word.

## Why it was given then

Everything underneath was finished and proven. What remained was that the first fifteen seconds
of the demo showed a different, broken product. Carrying a template's dead surface into a
submission reads as a project that was never taken past the scaffold, and it was actively
undermining the one bounty gate the project most clearly clears.

## One design decision worth recording

`/api/retainer/status` is **new, and deliberately separate from the gate.** Asking the gated
route about an agent without access *starts a payment* — so a UI polling that route would open a
payment challenge every few seconds purely to draw a countdown. A read-only status endpoint is
the correct shape; reusing the gate would have been a subtle way to make the demo lie.

## What the commit removes

`docker-compose.yml`; the whole `facilitator/` directory; `FileRegistry.sol` and its deploy
script and tests; `app/api/files/*`; `app/files/*`; the entire `app/blockexplorer/`;
`services/registry/server.ts`; `services/storage/client.ts`; `hooks/scaffold-hbar/useRegistryFileListing.ts`;
`scripts/x402-buy.ts`. Net −9,470 lines against +439.

No Docker, no MinIO and no self-hosted facilitator are needed to run this project any more.

## What it adds or renames

- `app/api/retainer/status/route.ts` — the read-only status endpoint above
- `app/page.tsx` — the live view: window countdown, observed renewals, HashScan links
- package identities renamed off the template's `sh` / `@sh/*` to `retainer` /
  `@retainer/hardhat` / `@retainer/nextjs`
- page title and description no longer say Scaffold-HBAR

The template's *origin* stays disclosed in `specs/provenance.md` and `AI-USAGE.md`. What is
removed is its product, not the acknowledgement that it was the starting point.
