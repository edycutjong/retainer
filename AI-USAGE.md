# AI Usage

ETHGlobal requires disclosure of where and how AI tools were used, naming files. This file is
that disclosure. It is specific rather than general, because a vague version of this file is
worth nothing to a judge.

The short version: **essentially every line of source text in this repository was written by
Claude Code.** No file below is claimed as hand-typed. What a human did is direction, review,
correction, the accounts and the money, the live testnet runs, the demo video, and the decision
on what ships — set out concretely in [Human contribution](#human-contribution).

## Tools used

| Tool | Used for |
|---|---|
| Claude Code (Opus 5) | Research, architecture, all Solidity/TypeScript generation, tests, docs, this file |

No other AI tool was used. In particular **no AI voice synthesis is used anywhere in this
submission** — ETHGlobal disqualifies synthesised narration, so the demo video is narrated by a
real recorded human voice.

## How it was directed

A spec-driven workflow, so ETHGlobal's disclosure rule fires and the artifacts that directed
the AI are in this repository:

- `specs/` — `architecture.md`, `provenance.md`
- `prompts/` — one file per build step, indexed in `prompts/README.md`, which states plainly
  that those files are reconstructed from the commit history rather than a keystroke log
- the commit history itself — the build commits indexed in `prompts/README.md`, each one a
  step or a correction. It is the highest fidelity record here and every claim below names the
  commit it can be checked against.

## Per-file attribution — files this project authored

Eleven new source files are ours, plus the landing page and its components, which were rewritten in place and then rebuilt as a landing page (step 12).
Everything else in the tree is either the template's (see
[below](#inherited-from-the-template-unchanged)) or machine-generated.

### Contract and tests

| File | AI-generated | Human-directed | Human-reviewed / corrected |
|---|---|---|---|
| `packages/hardhat/contracts/RetainerAccess.sol` (438 lines) | All Solidity: subscription state, the three separated pots (`_owed` / `revenue` / `gasReserve`), the `_solvent()` invariant, and every Hedera Schedule Service call — `scheduleCall`, `deleteSchedule`, `hasScheduleCapacity` | The product itself — access that re-arms its own renewal instead of being re-authorised by a person. Approved: money split three ways rather than one balance; `renew()` permissionless but time-gated; lapse loudly rather than revert | Four review passes changed the contract after it "worked". `b68b540` fixed a griefing vector where a stranger could force renewals, added the revenue path and split the pots. `818c517` added `RENEW_SLACK` after the **real** testnet scheduler fired a second early and the time gate rejected it. `78025d2` fixed four money bugs — the subscriber setting their own price, the subscriber setting a period shorter than `RENEW_SLACK`, cancel abandoning a paid-for schedule, and what looked like weibar/tinybar confusion — and added `creditFor`. `c0d7e08` added `subscribeFor`. `9eb39e3` then reversed the unit half of that: `UnitProbe.sol`, deployed to testnet, showed the EVM is already tinybar, so the conversion `78025d2` added was itself an overpay bug |
| `packages/hardhat/contracts/test/MockScheduleService.sol` (55 lines) | A stand-in for system contract `0x16b`, installed with `hardhat_setCode`, with switchable failure modes | Decision that the mock replaces **only the scheduler** — never the product logic. That the real Schedule Service behaves as assumed is proven on testnet, not by this mock, and the file says so in its own header | Kept deliberately dumb; the lapse paths exist here because testnet cannot be asked to refuse you on demand |
| `packages/hardhat/contracts/test/UnitProbe.sol` (32 lines) | A throwaway probe that measures, on-chain, whether Hedera's EVM denominates `msg.value` in weibar or tinybar | Requirement that the unit question be settled by measurement rather than by reasoning from Ethereum's semantics | Not on the shipped path and not imported by the test suite; kept because it is the evidence that overturned the unit change made in `78025d2` (`9eb39e3`) |
| `packages/hardhat/test/RetainerAccess.test.ts` (601 lines, 64 tests) | Every test, including the unit-conversion, griefing, money-separation, lapse and access-window suites | Requirement that each bug fixed above gets a test that fails without the fix, and that each reachable lapse reason is asserted by name (four of the five; the fifth guards a branch `_armRenewal` should make unreachable) | The suite missed the early-firing scheduler entirely — that regression was caught on testnet, not in CI. The test *"accepts a renewal that fires slightly EARLY, as the real scheduler does"* exists because of it (`818c517`) |
| `packages/hardhat/deploy/01_deploy_retainer_access.ts` | Deploy script, constructor args, Hedera gas limits | Human supplied the funded deployer account and the beneficiary address | Reworked in `78025d2` when the constructor took terms |

### Resource server, agent, and live view

| File | AI-generated | Human-directed | Human-reviewed / corrected |
|---|---|---|---|
| `packages/nextjs/app/api/retainer/access/route.ts` (227 lines) | The x402 gate: build payment requirements, answer 402, verify and settle through the Blocky402 facilitator, then forward the settled payment on-chain into `subscribeFor(agent)` | The behaviour that had to be visible in the response body: `paidThisRequest:false` on request two, and 200 after the window should have expired | Split across `c047b63` (gate) and `c0d7e08` (settlement actually opens the subscription — before that the payment and the on-chain state were not joined) |
| `packages/nextjs/app/api/retainer/status/route.ts` | Read-only subscription state for polling | Kept deliberately separate from the gate route: polling the gate would open a fresh payment challenge every second just to draw a countdown | Reviewed for that one property |
| `packages/nextjs/services/retainer/server.ts` (203 lines) | The ABI subset, viem read clients, and the server wallet that forwards settled payments (`RETAINER_SERVER_KEY`) | Requirement that the server holds a key that can only *credit and open* subscriptions, never spend subscriber balances | Grew with `c0d7e08`; the credit-vs-revenue distinction is asserted in the contract tests |
| `packages/nextjs/services/audit/hcs.ts` (~210 lines) | The HCS writer: record types, single-message sizing, operator resolution, and a submit path that resolves rather than rejects on every failure | One requirement, stated before any code: the audit trail must be incapable of failing a payment. That is why it runs in `after()`, why it is off unless `HCS_AUDIT_TOPIC_ID` is set, and why nothing in the file throws | The oversized-record path was written after asking what happens when a revert string is long: the SDK would silently chunk it and break the one-message-one-event property the verifier relies on |
| `packages/nextjs/scripts/hcs-create-topic.ts` (~90 lines) | Creates the topic and prints its id, HashScan and mirror-node URLs | Direction that the topic be created with a submit key and **no admin key** — a trail its author can delete is not evidence | Human ran it once on testnet; the resulting `0.0.10440194` is the topic in the docs, and the mirror node confirms `admin_key: null` |
| `packages/nextjs/scripts/verify-audit-trail.ts` (~150 lines) | Reads the topic from the public mirror node and resolves every identifier each record names back to a transaction | Requirement that verification take no credentials and never touch Retainer's own server, so a sceptical reader is not asked to trust the thing being audited | Rewritten after a real run: the two records of one paid request are submitted independently and consensus put them out of logical order, so the join had to become the settlement id rather than the sequence number |
| `packages/nextjs/scripts/retainer-agent.ts` (153 lines) | The end-to-end agent demo: 402 → sign → settle → 200 unpaid → wait past expiry sending nothing → 200 again | The script exists to satisfy Hedera's bounty requirement 2 — an agent that completes a real paid request end to end — rather than to look good | Human runs it against testnet; its step 5 is the claim the whole project stands on |
| `packages/nextjs/app/page.tsx` (244 lines, replacing the template's landing page) | The live view: window counting down, renewal log, HashScan links, all read from `/api/retainer/status` | The hard part of the brief: the product's whole claim is about something that happens when nobody is watching. The page had to show the counter reach zero and *not* go dark | Reviewed for the rule that nothing on the page is simulated — every number is chain state |
| `packages/nextjs/app/page.tsx` (rebuilt as the landing page — claim, instrument, receipt band, `402 → pay → 200 → still 200`, live panels, proof ledger, questions, limitations, final CTA) | All markup and copy | A written design spec first (kitchen-side), then the page against it: the moment the ring closes had to be in the first viewport for a cold visitor; every number traceable to chain state or `docs/proof.md`; nothing claimed-but-unbuilt allowed back on the page | Five screenshot passes at three widths and two themes; each pass's three weakest findings fixed. Prompt `prompts/12-the-landing-page-as-an-instrument.md` |
| `packages/nextjs/components/landing/Instrument.tsx`, `Ring.tsx` | The hero instrument: the access window as a ring with the scheduled call as a pin; two labelled modes (recorded run at 10× time, live chain); tabs, Play/Step, `aria-live` announcements | The recorded run exists because the live demo agent had lapsed when the page was designed; it must always be labelled as recorded, never autoplay under reduced motion, and switch to the live chain explicitly | The stale-mint step bug and the live label were found by stepped screenshots, not by reading |
| `packages/nextjs/components/landing/recordedRun.ts` | The four transactions of the measured run, transcribed from `docs/proof.md` with HashScan links | Rule: every figure copied verbatim from the docs — no smoothing, no re-rounding | Checked row by row against `docs/proof.md` artifacts 3–6 |
| `packages/nextjs/components/landing/useLiveWindow.ts` | The old page's polling, ticking and renewal-detection logic, lifted into a hook; a silent single retry for the relay's spurious reverts | Behaviour had to be preserved exactly; only the retry is new | The retry was added after a local run showed the public relay refusing a plain view read |
| `packages/nextjs/styles/globals.css` (the `--rt-*` token layer and `.rt-*` recipes) | Tokens, component classes, motion, reduced-motion guard | Contrast measured for every text/background pair in both themes before a value was accepted; the tokens file's light-mode stub was rejected on measurement | Two cascade bugs (padding shorthand, unlayered margin reset) found by screenshots |
| `packages/nextjs/components/Header.tsx`, `components/Footer.tsx` | Rewritten: product mark, section nav, skip link, real footer with version stamp and provenance | The footer must say where the template came from. The version string is read from the root `package.json` at build time and now stamps `v1.0.0`; `v0.0.0-dev` survives only as a deliberately implausible fallback, so a broken pipeline is visible rather than quietly wrong | — |
| `packages/nextjs/app/judge/judge.module.css` | Colour and type values brought into the same family | Stays a self-contained module on purpose, so `/judge` cannot break when the product's system changes | — |
| `e2e/` (5 specs, 24 tests: `landing` 7, `gate` 6, `judge-route` 4, `smoke` 4, `responsive` 3) | The landing page's structure, asserted at the level a judge experiences it | Must not depend on the chain answering | — |
| `app/api/retainer/status/route.ts` (partial reads, step 13) | `Promise.allSettled` over the three contract reads; auxiliary failures become `null` + `unavailable` | The window state must return even when the relay refuses an auxiliary view read; nothing may be invented for a field the chain did not answer | Verified against the local `.env` misconfiguration that used to 502 |
| `components/landing/recordedRun.ts`, `app/page.tsx`, `app/judge/page.tsx`, `JUDGE.md`, `docs/proof.md`, `README.md`, `RUNBOOK.md`, `specs/architecture.md`, `docs/gas-economics.md` (truth correction, step 13) | The corrected receipts: 19 renewals across three deployments, the current deployment's eight-renewal chain, the reverted scheduled call, the corrected x402 settlement | Every number re-derived from the mirror node by `entity_id`, `scheduled`, `result` and `charged_tx_fee` before it was written; a claim that did not resolve was removed, not softened | The misattribution was found by resolving the HashScan link a judge would click, not by reading the docs. Prompt `prompts/13-audit-the-claims-against-the-chain.md` |
| `app/layout.tsx`, `styles/globals.css` (font policy, step 13) | Montserrat via `next/font/google`; the remote Styrene A Web face removed | CLS on `/judge` had to reach 0 without adding a face the other surfaces do not use | Measured with a `PerformanceObserver` probe and Lighthouse before and after |

### Diagnostics and proof scripts

| File | AI-generated | Human-directed | Human-reviewed / corrected |
|---|---|---|---|
| `packages/hardhat/scripts/proveRenewal.ts` | Subscribes, then waits and watches without sending anything further; it also checks that a refund pays out the real amount, as a regression guard on the contract's unit handling (`9eb39e3`) | Written to answer one question — does `Renewed` fire with no transaction from us? Its testnet output is the proof cited in the README | Human ran it on testnet, read the results off the mirror node, and kept the run that showed the third renewal lapsing rather than only the two that succeeded |
| `packages/hardhat/scripts/diagnose.ts` | Checks that `0x16b` really is present on testnet, plus contract state dumps | Written because "the system contract exists" was an assumption, and assumptions about the sponsor's platform are the ones that sink a build | Kept in the repo rather than deleted — it is how anyone else verifies the same thing |

### Documentation in this repo

`AI-USAGE.md`, `specs/architecture.md`, `specs/provenance.md`, `docs/proof.md`,
`docs/gas-economics.md` and `prompts/*.md` are AI-written and human-reviewed. `specs/provenance.md` carries dated
corrections recording claims it previously got wrong, rather than quietly fixing them.

`README.md` descends from the template's own README. Where it describes Retainer the prose is
AI-drafted and human-reviewed; where it still describes generic `scaffold-hbar` setup (Node
version, Yarn workspaces, key import) that text is the template's.

`RUNBOOK.md` descends from the template's runbook and was rewritten for Retainer in `9eb39e3`
(408 insertions, 229 deletions against the version at `4a0ddc3`). It now walks a clean checkout
through compile, tests, deploy, the resource server and the on-chain confirmation of a renewal;
`FileRegistry`, MinIO, `docker-compose` and `yarn infra:up` appear in it only in the sentence
saying they were removed. AI-drafted and human-reviewed, like the rest of the prose here.

## Inherited from the template, unchanged

This project was built from **`hedera-dev/scaffold-hbar`**, branch
`templates/x402-pay-per-use` (<https://github.com/hedera-dev/scaffold-hbar>) — the starter
template Hedera's own bounty page names. That is allowed, and stating it is better than letting
a judge discover it. The template's own product — a MinIO-backed pay-per-download file
marketplace, `FileRegistry`, block explorer, docker-compose and self-hosted facilitator — was
removed in `c939840`.

None of the following is our work. It is the template's, byte-identical to the initial commit:

- **x402 plumbing:** `packages/nextjs/services/x402/client.ts`, `services/x402/walletSigner.ts`,
  `utils/x402.ts`. The x402 client-side signing path is the template's; what we built on top of
  it is the subscription that makes a single payment keep paying.
- **Hedera wallet/RPC layer:** `services/web3/appKitHedera.ts`, `appKitConfig.ts`,
  `wagmiConfig.tsx`, `hederaWalletConnect.tsx`; `app/api/hedera/{account,contract,transaction}/route.ts`.
- **Scaffold UI and hooks:** `components/scaffold-hbar/**`, `components/{SwitchTheme,ThemeProvider,WalletAutoReconnect,LocalChainErrorBanner,ScaffoldHbarAppWithProviders}.tsx`,
  `app/debug/**`, `app/not-found.tsx`, all 17 remaining `hooks/scaffold-hbar/*` files,
  `utils/scaffold-hbar/**`, `scaffold.config.ts`. (`styles/globals.css` and `components/Footer.tsx` began as the template's and were rewritten in step 12; both are listed above.)
- **Hardhat harness:** `hardhat.config.ts`, `scripts/{generateAccount,generateTsAbis,importAccount,listAccount,revealPK,runHardhatDeployWithPK,verifyDeployed}.ts`,
  `utils/{getDeployGasPrice,resolveHederaContractId}.ts`.
- **Tooling and config:** `.github/workflows/lint.yaml`, `.husky/`, `.lintstagedrc.js`,
  `.yarn/**`, eslint/prettier/tsconfig, `next.config.ts`, `vercel.json`, `LICENCE`,
  `public/**` (Hedera brand assets).
- `packages/nextjs/contracts/fileRegistryAbi.ts` — a leftover of the template's removed
  marketplace. Unused by Retainer.

Template files we edited, all small and all listed with their reason in `specs/provenance.md`:
`services/x402/server.ts` (facilitator default → hosted Blocky402, `8243c11`),
`packages/nextjs/.env.example`, `app/layout.tsx` (also `lang="en"`, step 12), `components/Header.tsx`,
`components/SwitchTheme.tsx` (an `aria-label` on the toggle, step 12), `components/ScaffoldHbarAppWithProviders.tsx` (`id="content"` on `<main>` for the skip link, step 12),
`utils/scaffold-hbar/getMetadata.ts`, `hooks/scaffold-hbar/index.ts` +
`useHederaEvmAddress.ts`, `services/web3/hederaContractWrite.ts`, and the three `package.json`
files (`@sh/*` → `@retainer/*`).

`packages/nextjs/contracts/deployedContracts.ts` is neither AI-written nor hand-written: it is
generated by the template's `generateTsAbis.ts` from compiled artifacts.

## Human contribution

ETHGlobal warns that relying entirely on AI *"without meaningful contributions from team
members"* forfeits partner prizes and finalist consideration. Concretely, the human:

- **Chose the sponsor and the track** — Hedera's x402 bounty — and chose the angle: not another
  pay-per-call demo, but the thing x402 cannot do today, which is subscribe.
- **Created and funded the Hedera testnet accounts** — deployer/seller and buyer/agent — and
  keeps their keys in `~/.config/retainer/`, never in this tree. Nothing on-chain in this
  project exists without that step, and no AI can do it.
- **Approved the architecture decisions**: three separated pots instead of one balance;
  `renew()` public but time-gated; the mock replacing only the scheduler; the status route kept
  off the payment path; one x402 payment buying `RETAINER_PERIODS_PER_PURCHASE` periods.
- **Ran the live testnet proof and read the mirror node**, which is where the numbers in the
  README come from: `subscribe()` at 1,582,554 gas, three scheduled `CONTRACTCALL`s with
  `scheduled=True`, two at 1.54896 HBAR and the third at 0.0507 HBAR, where it charged the
  subscriber's last period and then lapsed instead of re-arming. The 30× gap between them — re-arming the next renewal is ~97% of a renewal's cost — was
  found by measuring, not by reasoning.
- **Decided that that finding ships as written.** At a 1 HBAR period price the product loses
  money on every renewal. It would have been easy to price the demo around the problem; instead
  it is stated in the README as the real constraint of on-chain self-renewal.
- **Caught the regressions that the tests did not** — the scheduler firing a second early, and a
  provenance file that claimed a facilitator change which had not actually been made.
- **Records the demo video with a real recorded human voice**, no synthesised narration.
- **Final judgement on what ships**, including what was cut.

## Where the line honestly sits

The code is AI-written. The judgement about what to build, what to keep, what was actually true
on testnet, and what to admit is not. A judge should read this repo as a human directing and
auditing a fast code generator — reviewing hard enough to have rejected four money bugs, one
griefing vector and one false claim before submission — and not as a human who typed 436 lines
of Solidity.
