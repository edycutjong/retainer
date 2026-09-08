# Provenance — what came from where

Kept current so the origin of every part of this repository is clear. Stated openly because the
starting point is permitted and hiding it would read far worse than naming it.

## This repository started from a template

**`hedera-dev/scaffold-hbar`, branch `templates/x402-pay-per-use`**
<https://github.com/hedera-dev/scaffold-hbar>

That template is listed on Hedera's own bounty page as its official **Starter template**, and
is normally scaffolded with:

```bash
npx create-scaffold-hbar@latest --template x402-pay-per-use
```

It landed here as commit **`4a0ddc3` — "Initial commit: x402 pay-per-use scaffold on Hedera
testnet"**, which is the honest baseline: all the *code* in that commit is the template's, and
every line of code after it is this project's. The one qualification, stated because the file
that draws this line should not blur it: that same commit also added four documents of ours —
`AI-USAGE.md`, `prompts/README.md`, `specs/architecture.md` and this file — as its own message
records. `git log` is the audit trail, and the diff of `4a0ddc3..HEAD` is the exact answer to
"what code did you actually build".

**The template's own product is gone.** It shipped a pay-per-download file marketplace —
private MinIO storage, a `FileRegistry` contract, a self-hosted x402 facilitator, a block
explorer, and a `docker-compose` stack. None of that is part of Retainer, and none of it is
documented as if it were. The full removal list is below.

---

## What the template provided, and is still in use

| Area | What it gave us |
|---|---|
| Monorepo shell | Yarn 3 workspaces (`packages/hardhat`, `packages/nextjs`), husky + lint-staged, eslint/prettier configs, `.github/workflows/lint.yaml` |
| Hardhat setup | `hardhat.config.ts` with the Hedera testnet/mainnet networks, `hardhat-deploy`, verify tasks, the account scripts (`generateAccount`, `importAccount`, `listAccount`, `revealPK`, `runHardhatDeployWithPK`), `generateTsAbis`, `getDeployGasPrice`, `resolveHederaContractId` |
| Next.js app shell | App Router layout, theming, `Header`/`Footer`, the `/debug` contract UI, Hedera branding assets |
| scaffold-hbar library | `components/scaffold-hbar/*`, `hooks/scaffold-hbar/*`, `utils/scaffold-hbar/*` — address display, contract read/write hooks, mirror-node helpers, notifications |
| Wallet wiring | Reown AppKit + HashPack over the native `hedera` WalletConnect namespace (`services/web3/*`) |
| x402 plumbing | `services/x402/server.ts` (resource server + `ExactHederaScheme`), `services/x402/client.ts`, `services/x402/walletSigner.ts`, `utils/x402.ts` (tinybar/HBAR conversion) |

Retainer's contribution sits **on top of** that plumbing: the template knew how to take a
one-shot x402 payment. It had no notion of a subscription, of scheduled execution, or of a
contract that pays for its own future.

## What was removed from the template

Deleted outright in `4a0ddc3..HEAD` (verifiable with `git diff --name-status`):

**The marketplace product**
- `packages/hardhat/contracts/FileRegistry.sol`, `deploy/00_deploy_file_registry.ts`,
  `test/FileRegistry.test.ts`
- `packages/nextjs/app/api/files/*` (list, detail, upload, download routes)
- `packages/nextjs/app/files/*` (browse, detail, upload pages)
- `packages/nextjs/services/storage/client.ts` (MinIO / S3 presigning),
  `services/registry/server.ts`, `hooks/scaffold-hbar/useRegistryFileListing.ts`
- `packages/nextjs/scripts/x402-buy.ts` (the template's CLI buyer)

**The self-hosted facilitator and its infrastructure**
- `facilitator/` in full (`src/server.ts`, `Dockerfile`, `package.json`, README, env example)
- `docker-compose.yml` (MinIO + facilitator)

**The block explorer**
- `packages/nextjs/app/blockexplorer/*` — pages, components, transaction and address views

**Template machinery and assistant config**
- `template.json` — the `create-scaffold-hbar` CLI manifest, meaningful only while this repo
  *is* a template
- `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/` — assistant-config files, stripped from the
  template **on the way in**, under house rules that keep them out of a public repo. They were
  removed before `4a0ddc3`, so unlike everything else in this list they never appear in the
  history at all

Consequence worth stating plainly: **Retainer needs no Docker, no MinIO and no self-hosted
facilitator.** Settlement goes through the hosted Blocky402 testnet facilitator.

### Template residue, as of 2026-09-08

Not everything the marketplace touched has been swept yet. Naming it here so it reads as
leftover rather than as a feature:

- `packages/nextjs/contracts/fileRegistryAbi.ts` — orphaned ABI, no longer imported by any
  shipped route
- `packages/nextjs/.env.example` still carries `S3_*` and `FILE_REGISTRY_*` keys alongside the
  Retainer ones; the only file that reads any of them is the orphaned ABI above, which nothing
  imports
- `packages/nextjs/package.json` still declares an `x402:buy` script pointing at
  `scripts/x402-buy.ts`, which was deleted with the marketplace, and still depends on
  `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner`, which only the deleted MinIO client
  used. The root `package.json` dropped its own `x402:buy`, `infra:*` and `facilitator:*`
  scripts; the workspace one was missed
- `README.md` is an inherited file, rewritten for Retainer as the template's product came out.
- `RUNBOOK.md` is inherited and **has not been rewritten**. It still walks through the
  template's marketplace end to end — `FileRegistry`, MinIO, `docker-compose`, the self-hosted
  facilitator, `yarn infra:up` — all of which `c939840` deleted. It describes a product this
  repository no longer contains and commands that no longer exist. Named here as the largest
  outstanding piece of residue rather than left for a judge to find.

---

## What is ours

Written for this project. Every source file below was added after `4a0ddc3`; the four
documents at the bottom of the table were added *in* `4a0ddc3`, alongside the template import,
and have been extended since.

| File | Origin |
|---|---|
| `packages/hardhat/contracts/RetainerAccess.sol` | AI-written, human-reviewed |
| `packages/hardhat/contracts/test/MockScheduleService.sol` | AI-written, human-reviewed |
| `packages/hardhat/contracts/test/UnitProbe.sol` | AI-written, human-reviewed |
| `packages/hardhat/deploy/01_deploy_retainer_access.ts` | AI-written, human-reviewed |
| `packages/hardhat/test/RetainerAccess.test.ts` (38 tests) | AI-written, human-reviewed |
| `packages/hardhat/scripts/proveRenewal.ts` | AI-written, human-reviewed |
| `packages/hardhat/scripts/diagnose.ts` | AI-written, human-reviewed |
| `packages/nextjs/app/api/retainer/access/route.ts` | AI-written, human-reviewed |
| `packages/nextjs/app/api/retainer/status/route.ts` | AI-written, human-reviewed |
| `packages/nextjs/services/retainer/server.ts` | AI-written, human-reviewed |
| `packages/nextjs/scripts/retainer-agent.ts` | AI-written, human-reviewed |
| `docs/gas-economics.md` | AI-written, human-reviewed |
| `AI-USAGE.md` | AI-written, human-reviewed |
| `prompts/` | AI-written, human-reviewed |
| `specs/architecture.md` | AI-written, human-reviewed |
| `specs/provenance.md` | AI-written, human-reviewed |

Human contribution — direction, sponsor and track choice, account creation and funding, review
and approval of the architecture, and the demo recording — is recorded in `AI-USAGE.md`.

## Template files we changed

| File | Change | Why |
|---|---|---|
| `packages/nextjs/services/x402/server.ts` | `FACILITATOR_URL` defaults to the hosted Blocky402 testnet facilitator | Settlement must go through Blocky402. Making it the **code default** means a fresh clone uses the correct rail with no extra configuration. |
| `packages/nextjs/.env.example` | Same default, plus the `RETAINER_*` block | So the documented setup path matches the code. |
| `packages/nextjs/app/page.tsx` | Replaced entirely | Was the template's marketplace landing page; is now the live view that watches one agent's window renew itself. |
| `packages/nextjs/components/Header.tsx` | Nav reduced to Home + Contract | The Files and Block Explorer entries pointed at deleted pages. |
| `packages/nextjs/hooks/scaffold-hbar/index.ts` | Dropped the `useRegistryFileListing` export | The hook was deleted with the marketplace. |
| `packages/nextjs/app/layout.tsx`, `utils/scaffold-hbar/getMetadata.ts` | Title and metadata → Retainer | Was "Scaffold-HBAR". |
| `package.json`, `packages/*/package.json` | Renamed to `retainer`, `@retainer/hardhat`, `@retainer/nextjs`. The root `package.json` also dropped its `infra:*` (docker-compose), `facilitator:*` and `x402:buy` scripts | The docker stack, the facilitator directory and the template's CLI buyer were all deleted, so those scripts pointed at nothing. |
| `packages/hardhat/package.json` | Added `@hiero-ledger/hiero-contracts` | `RetainerAccess.sol` imports `HederaScheduleService` and `HederaResponseCodes` from it — this is the Schedule Service interface the whole product runs on. |
| `packages/nextjs/services/web3/hederaContractWrite.ts`, `hooks/scaffold-hbar/useHederaEvmAddress.ts` | Small fixes | Carried over from the template's own usage. |
| `README.md`, `RUNBOOK.md` | Rewritten for Retainer | They documented the marketplace, its Docker stack and its self-hosted facilitator. |
| `packages/nextjs/contracts/deployedContracts.ts` | Regenerated on deploy | Generated artifact — `RetainerAccess` in place of `FileRegistry`. |

---

## Corrections

Recorded rather than quietly fixed, because a provenance file that overstates what changed is
worse than none.

**2026-09-07 — the facilitator default.** An earlier version of this file claimed the
facilitator change was already made. **It was not.** At that point Blocky402 existed only in a
local, gitignored `.env`, while every tracked file still defaulted to the self-hosted
`localhost:4020`; anyone cloning the repo would have used the wrong facilitator. Found by an
audit pass and fixed in commit `8243c11`.

**2026-09-08 — two integrations claimed but never built.** `specs/architecture.md` listed an
**HCS audit trail** and the **Hedera Exchange Rate system contract** (`tinycentsToTinybars`
USD pricing) as shipped, load-bearing components. Neither exists anywhere in this repository
and neither ever did. Both claims are removed; both now appear in that file only under an
explicit "Not built" heading. Claiming an integration that is not in the code is worse than
not having it.

**2026-09-08 — three provenance claims that did not survive checking.** A fact-check against
`git log` found this file overstating the line between the template and us in three places, all
now fixed above. (a) It said everything in `4a0ddc3` was the template's; that commit also added
our four disclosure documents. (b) It said every file under *What is ours* was added after
`4a0ddc3`; those same four documents were added in it. (c) It listed `AGENTS.md`, `CLAUDE.md`,
`.claude/` and `.agents/` as deleted within `4a0ddc3..HEAD`; they were stripped before the
initial commit and appear nowhere in the history, so `git diff --name-status` does not show
them. The same pass found `RUNBOOK.md` described here as rewritten for Retainer when it is
still the template's marketplace runbook.

*Updated as the build proceeds.*
