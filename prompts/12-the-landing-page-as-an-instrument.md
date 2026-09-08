# 12 — Make the landing page carry the moment, not describe it

**Commits produced:** the landing-page series that follows `9c7d416` — the shared token layer and
header/footer, the recorded-run instrument, the page rebuild, the family pass on `/judge`, and
the landing e2e spec. Each commit message names its own reason.
**When:** 2026-09-08, afternoon +07

## The direction given

Write a design spec first, then rebuild `app/page.tsx` against it. Keep the stack (Next.js 15,
Tailwind v4, daisyUI 5) — no framework migration this close to the deadline. Keep every honest
behaviour the page already had: the 4-second chain poll via `/api/retainer/status`, the local
one-second tick, the renewal-detected flash, the metered-call log, the HashScan links, the empty
state, the demo-agent button, the wallet address auto-fill.

Then fix what was wrong with it as a page. The countdown that springs back to a full window with
nobody awake is the whole product, and it was a plain SVG ring below an address input, invisible
to a visitor who had not typed anything. The rest was stock scaffold: six identical daisyUI cards,
default badges, a flat masthead, no how-it-works for a cold visitor, no proof band, no route to
`/judge`, no footer landmark.

Hard gates, not preferences: 4.5:1 on all text in both themes, `prefers-reduced-motion` honoured
by every animation added, visible keyboard focus, real `aria` on the countdown and the meter,
semantic landmarks, and every number on the page traceable to chain state or a receipt in
`docs/proof.md`. Nothing that was claimed in specs but never built (HCS audit trail, USD pricing)
may reappear. No user counts, no testimonials, no invented metric.

## Why it was given then

Round 1 of ETHGlobal judging is asynchronous review of the page and the video. Usability and WOW
are two of the five criteria and they are scored on exactly this surface. The page was honest and
correct and looked like a template.

## The finding that shaped the design

Before writing the spec, the live state was checked: the demo agent's subscription on
`0.0.10415845` had **lapsed** — `hasAccess:false`, balance 0, `renewalsReserveCanArm: 0`. A hero
that depended on live state would have shown a dead product on judging day.

So the instrument got two modes, both labelled at all times. **Recorded run** replays the four
transactions the network actually executed on testnet — transcribed verbatim from `docs/proof.md`
into `components/landing/recordedRun.ts`, each row a HashScan link — at 10× time, and says so on
the instrument. **Live chain** is the same ring driven by `/api/retainer/status` for any address.
On arrival the page reads the demo agent once; if its window is open on chain, the instrument
starts live, because the real thing beats a replay whenever it is alive.

## What the work produced

- `styles/globals.css` — a token layer (`--rt-*`) the landing page, header, footer and `/judge`
  share: the midnight plate, armed violet as a stroke and `#C4B5FD` as the same state written as
  text, renewed mint, and the light-theme inks that hold 4.5:1 (the tokens file's light stub
  `#94A3B8` measured 2.56:1 and was rejected; mint on white is 1.49:1 and is never used as text
  there). The instrument keeps the night in both themes.
- `components/landing/Instrument.tsx`, `Ring.tsx`, `recordedRun.ts`, `useLiveWindow.ts`,
  `useReveal.ts` — the hero; the live logic is the old page's, lifted intact into a hook.
- `app/page.tsx` — claim, instrument, receipt band, `402 → pay → 200 → still 200`, the live
  panels, the proof ledger with the one `curl` that returns the whole chain, five questions
  answered from the docs, the three limitations from `JUDGE.md`, a final CTA to `/judge`.
- `components/Header.tsx`, `components/Footer.tsx` — the product's own mark, section nav, a real
  footer with the version stamp (`v0.0.0-dev`, because no tag exists) and the provenance line.
- `app/judge/judge.module.css` — the same family, still self-contained on purpose.
- `e2e/landing.spec.ts` — the structure a judge relies on, pinned: one h1, the instrument in the
  first viewport, the replay labelled as recorded, an explicit switch to live, no autoplay under
  reduced motion, no sideways scroll at 375px.

## What was found by looking, and fixed

Five screenshot passes at 1440 / 768 / 375 in both themes, plus stepped captures of the fired,
lapsed and closed states. Findings that only a frame could show: the `.rt-container` padding
shorthand and an unlayered `p { margin: 0 }` were silently overriding Tailwind utilities (fixed by
side-only padding and `@layer base`); a nowrap label pill forced 52px of horizontal scroll at
375px; consensus timestamps wrapped mid-number; a fast Step left the previous fire's mint on a
drained frame; the public relay's occasional spurious revert on a plain view read now retries
once silently before it is shown; and the live label now derives from the contract the status
route actually read rather than a constant.

Lighthouse on the production build then added five: no `lang` on `<html>`, an icon-only theme
toggle with no name, footer links distinguished by colour alone, a skip link whose target did not
exist on `/judge`, and 0.27 of layout shift on `/judge` from the web-loaded mono face arriving
late — fixed by serving JetBrains Mono through `next/font/google`, which self-hosts it at build
time with size-adjusted fallback metrics.

## What was deliberately not done

No ShadCN, no framework change, no new display face (Inter was not added; the app's own brand
chain and JetBrains Mono for numerals). No count-up animations on the receipt numbers — they are
receipts, not growth. No testimonials, no logo wall, no user counts. The `/api/retainer/status`
route was not changed; its one auxiliary read that the relay sometimes refuses is handled by the
poller, and a route change is noted for a separate decision.
