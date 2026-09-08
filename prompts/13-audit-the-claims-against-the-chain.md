# 13 — Audit every claim against the chain, then fix what does not resolve

**Commits produced:** the QA series after `4244f63` — the truth correction across `docs/proof.md`,
`JUDGE.md`, `/judge`, the landing page, README, RUNBOOK and `specs/architecture.md`; the
`/api/retainer/status` partial-read change; the font-loading change; the brand hover state.
**When:** 2026-09-08, evening +07

## The direction given

Run an adversarial QA pass over the two judge-facing surfaces built that afternoon — the landing
page and the (kitchen-side) pitch deck. Do not trust either session's own grading. Build a
table of every number on both surfaces, resolve every HashScan link and mirror-node URL with a
real request, confirm `scheduled=true` and `SUCCESS` where claimed, re-run both test suites
rather than quoting the counts, and remove — not soften — any claim that does not resolve. Then
the interaction-QA discipline (hover byte-diff, keyboard traversal, reduced motion, CLS) over
both, three passes minimum, and decide the two defects the landing session had left open: the
0.27 CLS on `/judge` and the status route's whole-read 502.

## What the audit found

The headline receipt on every surface was misattributed. `1788827767.015718559` — cited as "the
renewal the current deployment executed" on `/judge`, JUDGE.md, README, RUNBOOK, proof.md,
gas-economics.md, the landing ledger and three deck slides — has `entity_id 0.0.10414167`, an
intermediate deployment (`9eb39e3`) no document named. `0.0.10415845` was created three hours
after it. The sentence had been written when `0.0.10414167` was current and carried across the
redeploy in `7400cd7` without being re-checked. A judge opening the deck's HashScan link would
have seen a different contract id than the receipt row above it.

Re-reading the chain by `entity_id` gave a better story than the one being told: **19**
unattended renewals across **three** deployments (3 · 7 · 9) instead of "4 across two"; the
current deployment had run the whole loop — eight renewals from one ordinary `renew()` to a loud
`Lapsed` — and reproduced the cost split within 0.6 %; its own x402 settlement existed
(`0.0.7162784@1788840225.936068496`). It also gave one thing nobody had noticed: a scheduled
execution on the deployed source that **reverted** with the contract's own `Insolvent()` guard
while the account held 239 million tinybar more than its books. That became limitation 3 and a
section of `docs/proof.md`, with the inference (a gas reservation on the payer during a
scheduled call) labelled as an inference and the fix left for a redeploy.

## What the work produced

- `docs/proof.md` — "Read this first" rewritten around three deployments with a dated
  correction; a new "The current deployment" section with every timestamp, the revert, and the
  commands that re-derive the count of 19.
- `JUDGE.md` / `app/judge/page.tsx` — receipt block, step 2 (the demo agent is described as it
  is, lapsed included), step 3 (one renewal + the one-request chain), limitation 3.
- `components/landing/recordedRun.ts` — `CURRENT_RUN`, `CURRENT_REVERT`, `UNATTENDED_RENEWALS`,
  the corrected `LIVE_SETTLEMENT`; `app/page.tsx` — the `19` tile, a second ledger for the
  current deployment including the reverted row, the FAQ, limitation 3.
- `app/api/retainer/status/route.ts` — `Promise.allSettled`: the window read is primary, the
  reserve and usage reads are auxiliary and come back `null` (named in `unavailable`) instead of
  failing the whole read with a 502. `useLiveWindow.ts` and the live panels say "unknown" /
  "unread this poll" rather than inventing a value.
- `app/layout.tsx` / `styles/globals.css` — the template's remote Styrene A Web `@font-face`
  (one weight, `display: swap`, fetched from a third-party font host) is removed; Montserrat, the
  brand's documented fallback and the face every other surface already used, is served through
  `next/font/google` like the mono face. `/judge` CLS: 0.271 → 0.
- README (three deployments, version badge, current-run paragraph), RUNBOOK,
  `specs/architecture.md`, `docs/gas-economics.md`, prompt 11 (dated correction), og:image alt.
- `.rt-brand` hover, `.rt-ledger` mono cells `nowrap`, `.is-reverted` row style.
- `e2e/landing.spec.ts` — unchanged assertions still pass; the suite count is reported in
  `submission/QA-AUDIT.md` (kitchen) verbatim.

## What was deliberately not done

No contract change and no redeploy — the revert is disclosed, not patched, because a fix spends
the human's testnet HBAR and changes the address every document cites. No re-funding of the demo
agent for the same reason; the page degrades honestly to the recorded run. No demo-video still on
the deck — the video does not exist yet and only the human can record it.
