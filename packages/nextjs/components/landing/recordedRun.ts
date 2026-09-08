/**
 * The recorded run — four real transactions, transcribed from `docs/proof.md`.
 *
 * The live demo agent's window is not always open (it had lapsed when this page was designed),
 * and a hero that depended on live state would show a dead product on the day it mattered. So the
 * instrument can replay the run the network actually executed on Hedera testnet, and it does so
 * from this table and nothing else: every timestamp, fee and schedule id below is on the public
 * mirror node and each row links to HashScan. Nothing here is invented, rounded differently from
 * the docs, or smoothed to look better.
 *
 * Re-verify (from docs/proof.md):
 *   curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7314364-1788780163-271854529" \
 *     | jq -r '.transactions[] | [.consensus_timestamp, .name, "scheduled=\(.scheduled)", .result, "fee=\(.charged_tx_fee)"] | @tsv'
 */

export const HASHSCAN = "https://hashscan.io/testnet";

/** The deployment that produced the run below — one revision behind the deployed source. */
export const RECORDED_CONTRACT = {
  id: "0.0.10406083",
  evm: "0x8B42a662b0Bd5EecF09517840f63A61AAbEb952A",
  periodSeconds: 60,
  date: "2026-09-07",
} as const;

/** The deployment the resource server talks to today. */
export const CURRENT_CONTRACT = {
  id: "0.0.10415845",
  evm: "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931",
} as const;

export type RecordedEvent = {
  kind: "subscribe" | "renewed" | "lapsed";
  /** Consensus timestamp, exactly as the mirror node reports it. */
  consensus: string;
  utc: string;
  type: "ETHEREUMTRANSACTION" | "CONTRACTCALL";
  scheduled: boolean;
  /** Fee charged to the contract (renewals) or gas used (subscribe), in the unit named by `feeLabel`. */
  feeLabel: string;
  /** The schedule this event armed for the next renewal, if any. */
  armed?: string;
  /** What the contract's own events said. */
  note: string;
  /** The line the instrument shows the moment this fires. */
  caption: string;
  chip: string;
  href: string;
};

export const RECORDED_RUN: readonly RecordedEvent[] = [
  {
    kind: "subscribe",
    consensus: "1788780167.771453657",
    utc: "11:22:47",
    type: "ETHEREUMTRANSACTION",
    scheduled: false,
    feeLabel: "1,582,554 gas",
    armed: "0.0.10406098",
    note: "SubscriptionStarted · period 60s · 4 ℏ funded · RenewalScheduled 0.0.10406098",
    caption:
      "11:22:47 UTC · subscribeFor · the agent's one payment becomes on-chain state · schedule 0.0.10406098 armed",
    chip: "+4 ℏ · subscribe",
    href: `${HASHSCAN}/transaction/1788780167.771453657`,
  },
  {
    kind: "renewed",
    consensus: "1788780226.016366208",
    utc: "11:23:46",
    type: "CONTRACTCALL",
    scheduled: true,
    feeLabel: "1.54896 ℏ",
    armed: "0.0.10406108",
    note: "Renewed · paid 1 ℏ · balance left 2 ℏ · RenewalScheduled 0.0.10406108",
    caption: "11:23:46 UTC · CONTRACTCALL · scheduled=true · SUCCESS · 1.54896 ℏ · re-armed 0.0.10406108",
    chip: "1.54896 ℏ · renewed",
    href: `${HASHSCAN}/transaction/1788780226.016366208`,
  },
  {
    kind: "renewed",
    consensus: "1788780286.019735208",
    utc: "11:24:46",
    type: "CONTRACTCALL",
    scheduled: true,
    feeLabel: "1.54896 ℏ",
    armed: "0.0.10406116",
    note: "Renewed · paid 1 ℏ · balance left 1 ℏ · RenewalScheduled 0.0.10406116",
    caption: "11:24:46 UTC · CONTRACTCALL · scheduled=true · SUCCESS · 1.54896 ℏ · re-armed 0.0.10406116",
    chip: "1.54896 ℏ · renewed",
    href: `${HASHSCAN}/transaction/1788780286.019735208`,
  },
  {
    kind: "lapsed",
    consensus: "1788780346.345418842",
    utc: "11:25:46",
    type: "CONTRACTCALL",
    scheduled: true,
    feeLabel: "0.0507 ℏ",
    note: 'Renewed · paid 1 ℏ · balance left 0 · Lapsed("balance will not cover the next period") · no schedule',
    caption:
      '11:25:46 UTC · CONTRACTCALL · scheduled=true · 0.0507 ℏ · Lapsed("balance will not cover the next period") · did not re-arm',
    chip: "0.0507 ℏ · lapsed",
    href: `${HASHSCAN}/transaction/1788780346.345418842`,
  },
];

/** The one unattended renewal the current deployment has executed so far. */
export const CURRENT_RENEWAL = {
  consensus: "1788827767.015718559",
  utc: "2026-09-08 00:36:07",
  type: "CONTRACTCALL",
  scheduled: true,
  feeLabel: "1.53816728 ℏ",
  note: "one unattended renewal on the deployed source; cancel() then deleted schedule 0.0.10414197",
  href: `${HASHSCAN}/transaction/1788827767.015718559`,
} as const;

/** The x402 settlement from the live end-to-end run (JUDGE.md receipt block). */
export const LIVE_SETTLEMENT = "0.0.7162784@1788830067.404863715";

/** Replay clock: 60 real seconds are shown in 6. Said on the instrument as "10× time". */
export const REPLAY_SPEED = 10;
