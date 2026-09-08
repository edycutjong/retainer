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

/** The deployment the resource server talks to today (created 2026-09-08 03:37:55 UTC). */
export const CURRENT_CONTRACT = {
  id: "0.0.10415845",
  evm: "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931",
  periodSeconds: 90,
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

/**
 * The current deployment's own run, read back from the mirror node on 2026-09-08. After a
 * 3 ℏ x402 payment (`0.0.7162784@1788840225.936068496`, settled by Blocky402) opened the
 * subscription and the network renewed it once (`1788840325.135282208`), the next scheduled
 * execution REVERTED with the contract's own `Insolvent()` guard (`1788840415.078121802`,
 * disclosed in the limitations). The seller re-funded the agent with `creditFor` and re-armed
 * it with one ordinary `renew()` call; from there the network executed eight renewals by itself
 * — seven that re-armed the next, and one that charged the last period and lapsed. Every row
 * below is one of those eight. Whole chain, one request:
 *
 *   curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7314364-1788844238-651641588" \
 *     | jq -r '.transactions[] | [.consensus_timestamp, .name, "scheduled=\(.scheduled)", .result, "fee=\(.charged_tx_fee)"] | @tsv'
 */
export const CURRENT_CHAIN_TX = "0.0.7314364-1788844238-651641588";

export type CurrentRow = {
  consensus: string;
  utc: string;
  feeLabel: string;
  kind: "renewed" | "lapsed";
  note: string;
  href: string;
};

const CURRENT_ROWS: Omit<CurrentRow, "href">[] = [
  {
    consensus: "1788844334.069565823",
    utc: "05:12:14",
    feeLabel: "1.54036168 ℏ",
    kind: "renewed",
    note: "Renewed · re-armed 0.0.10416728",
  },
  {
    consensus: "1788844424.147499693",
    utc: "05:13:44",
    feeLabel: "1.54036168 ℏ",
    kind: "renewed",
    note: "Renewed · re-armed 0.0.10416743",
  },
  {
    consensus: "1788844514.031171208",
    utc: "05:15:14",
    feeLabel: "1.54036168 ℏ",
    kind: "renewed",
    note: "Renewed · re-armed 0.0.10416751",
  },
  {
    consensus: "1788844604.062103189",
    utc: "05:16:44",
    feeLabel: "1.54036168 ℏ",
    kind: "renewed",
    note: "Renewed · re-armed 0.0.10416761",
  },
  {
    consensus: "1788844694.152962208",
    utc: "05:18:14",
    feeLabel: "1.54036168 ℏ",
    kind: "renewed",
    note: "Renewed · re-armed 0.0.10416782",
  },
  {
    consensus: "1788844784.021991773",
    utc: "05:19:44",
    feeLabel: "1.54036168 ℏ",
    kind: "renewed",
    note: "Renewed · re-armed 0.0.10416798",
  },
  {
    consensus: "1788844874.087845672",
    utc: "05:21:14",
    feeLabel: "1.53536968 ℏ",
    kind: "renewed",
    note: "Renewed · re-armed 0.0.10416816",
  },
  {
    consensus: "1788844964.085627208",
    utc: "05:22:44",
    feeLabel: "0.0522288 ℏ",
    kind: "lapsed",
    note: 'Renewed · balance 0 · Lapsed("balance will not cover the next period") · no schedule',
  },
];

export const CURRENT_RUN: readonly CurrentRow[] = CURRENT_ROWS.map(r => ({
  ...r,
  href: `${HASHSCAN}/transaction/${r.consensus}`,
}));

/** The current deployment's headline renewal — the first of the eight above. */
export const CURRENT_RENEWAL = CURRENT_RUN[0];

/** The scheduled execution on the current deployment that reverted (see limitations). */
export const CURRENT_REVERT = {
  consensus: "1788840415.078121802",
  error: "Insolvent()",
  feeLabel: "0.0654 ℏ",
  href: `${HASHSCAN}/transaction/1788840415.078121802`,
} as const;

/**
 * Unattended renewals across every deployment, counted on the mirror node on 2026-09-08:
 * `CONTRACTCALL`, `scheduled=true`, `SUCCESS`, each with a `Renewed` event. 3 on 0.0.10406083,
 * 7 on 0.0.10414167, 9 on 0.0.10415845. One further scheduled execution (the revert above) is
 * not counted.
 */
export const UNATTENDED_RENEWALS = { total: 19, deployments: 3, byContract: [3, 7, 9] } as const;

/** The x402 settlement (Blocky402) that opened the current deployment's subscription: 3 ℏ, agent → seller. */
export const LIVE_SETTLEMENT = "0.0.7162784@1788840225.936068496";

/** Replay clock: 60 real seconds are shown in 6. Said on the instrument as "10× time". */
export const REPLAY_SPEED = 10;
