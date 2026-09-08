import { describe, expect, it } from "vitest";
import {
  CURRENT_CHAIN_TX,
  CURRENT_CONTRACT,
  CURRENT_RENEWAL,
  CURRENT_REVERT,
  CURRENT_RUN,
  HASHSCAN,
  LIVE_SETTLEMENT,
  RECORDED_CONTRACT,
  RECORDED_RUN,
  REPLAY_SPEED,
  UNATTENDED_RENEWALS,
} from "~~/components/landing/recordedRun";

/**
 * The recorded run is the hero's evidence, and it is a hand-transcribed table.
 *
 * Nothing here can verify Hedera — the network is the authority for that, and `docs/proof.md`
 * carries the mirror-node commands that re-derive every row. What this suite verifies is the
 * transcription: that the numbers in the table still agree with each other and with the summary
 * counters the page states out loud.
 *
 * That is the failure this project has actually had. A counter gets edited by hand, the table it
 * summarises does not, and the page confidently states a total that its own rows contradict.
 * Every assertion below is a relationship between two things in the file, so editing one without
 * re-deriving the other fails here rather than in front of a judge.
 *
 * The consensus timestamp is the primitive everything else is checked against: it is what the
 * mirror node returned, so the human-readable `utc`, the HashScan link, the ordering and the
 * renewal cadence are all recomputed from it rather than trusted.
 */

/** The UTC wall-clock label a consensus timestamp must carry: whole seconds, `HH:MM:SS`. */
const utcOf = (consensus: string) => new Date(Number(consensus.split(".")[0]) * 1000).toISOString().slice(11, 19);

const secondsOf = (consensus: string) => Number(consensus);

describe("the recorded run — the table has to agree with the timestamps it was transcribed from", () => {
  it("labels every event with the UTC time its own consensus timestamp resolves to", () => {
    for (const event of RECORDED_RUN) expect(utcOf(event.consensus)).toBe(event.utc);
  });

  it("links every event to the HashScan page for that exact transaction, and never twice to the same one", () => {
    for (const event of RECORDED_RUN) {
      expect(event.href).toBe(`${HASHSCAN}/transaction/${event.consensus}`);
      expect(new URL(event.href).protocol).toBe("https:");
    }
    expect(new Set(RECORDED_RUN.map(e => e.href)).size).toBe(RECORDED_RUN.length);
  });

  it("orders the events strictly forward in time, because the instrument replays them in array order", () => {
    const times = RECORDED_RUN.map(e => secondsOf(e.consensus));
    expect(times).toStrictEqual([...times].sort((a, b) => a - b));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it("contains exactly one unscheduled transaction — the agent's single payment — and nothing after it was user-initiated", () => {
    const unscheduled = RECORDED_RUN.filter(e => !e.scheduled);
    expect(unscheduled).toHaveLength(1);
    expect(unscheduled[0].kind).toBe("subscribe");
    expect(RECORDED_RUN[0]).toBe(unscheduled[0]);
    // The two are the same fact seen twice: the agent's payment is an EVM transaction, every
    // renewal is the Schedule Service calling the contract.
    for (const event of RECORDED_RUN) {
      expect(event.scheduled).toBe(event.type === "CONTRACTCALL");
    }
  });

  it("fires the scheduled renewals one funding period apart, which is the claim the run exists to make", () => {
    const scheduled = RECORDED_RUN.filter(e => e.scheduled).map(e => secondsOf(e.consensus));
    expect(scheduled.length).toBeGreaterThan(1);
    for (let i = 1; i < scheduled.length; i++) {
      expect(Math.abs(scheduled[i] - scheduled[i - 1] - RECORDED_CONTRACT.periodSeconds)).toBeLessThan(1);
    }
  });

  it("ends by lapsing, and the lapse is the only event that armed no successor", () => {
    const last = RECORDED_RUN[RECORDED_RUN.length - 1];
    expect(last.kind).toBe("lapsed");
    expect(last.armed).toBeUndefined();
    expect(last.note).toContain("Lapsed(");
    expect(RECORDED_RUN.filter(e => e.kind === "lapsed")).toHaveLength(1);
    for (const event of RECORDED_RUN.slice(0, -1)) expect(event.armed).toBeTruthy();
  });

  it("arms a strictly increasing chain of schedule ids, each one named in the row that created it", () => {
    const armed = RECORDED_RUN.map(e => e.armed).filter((a): a is string => Boolean(a));
    expect(armed.length).toBeGreaterThan(1);
    const nums = armed.map(id => {
      expect(id).toMatch(/^0\.0\.\d+$/);
      return Number(id.split(".")[2]);
    });
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThan(nums[i - 1]);
    for (const event of RECORDED_RUN) {
      if (event.armed) {
        expect(event.note).toContain(event.armed);
        expect(event.caption).toContain(event.armed);
      }
    }
  });

  it("opens every caption with the same UTC time the row is stamped with, and every chip with the fee it charged", () => {
    for (const event of RECORDED_RUN) {
      expect(event.caption.startsWith(`${event.utc} UTC`)).toBe(true);
      expect(event.chip.endsWith(event.kind)).toBe(true);
      // The subscribe row is priced in gas, not hbar, so only the contract calls carry a fee the
      // caption and chip both quote.
      if (event.type === "CONTRACTCALL") {
        expect(event.caption).toContain(event.feeLabel);
        expect(event.chip).toContain(event.feeLabel);
      }
    }
  });

  it("was recorded on the day the deployment it names says it was", () => {
    const dates = new Set(
      RECORDED_RUN.map(e => new Date(Number(e.consensus.split(".")[0]) * 1000).toISOString().slice(0, 10)),
    );
    expect([...dates]).toStrictEqual([RECORDED_CONTRACT.date]);
  });
});

describe("the current deployment's run — eight rows the network executed by itself", () => {
  it("derives every HashScan link from the consensus timestamp rather than carrying a second copy of it", () => {
    for (const row of CURRENT_RUN) expect(row.href).toBe(`${HASHSCAN}/transaction/${row.consensus}`);
    expect(new Set(CURRENT_RUN.map(r => r.href)).size).toBe(CURRENT_RUN.length);
  });

  it("labels every row with the UTC time its consensus timestamp resolves to", () => {
    for (const row of CURRENT_RUN) expect(utcOf(row.consensus)).toBe(row.utc);
  });

  it("runs forward in time at the current contract's 90-second period, unattended, from first row to last", () => {
    const times = CURRENT_RUN.map(r => secondsOf(r.consensus));
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
      expect(Math.abs(times[i] - times[i - 1] - CURRENT_CONTRACT.periodSeconds)).toBeLessThan(1);
    }
  });

  it("renews until the funding runs out and lapses exactly once, at the end", () => {
    const lapsed = CURRENT_RUN.filter(r => r.kind === "lapsed");
    expect(lapsed).toHaveLength(1);
    expect(CURRENT_RUN[CURRENT_RUN.length - 1]).toBe(lapsed[0]);
    expect(lapsed[0].note).toContain("Lapsed(");
    expect(lapsed[0].note).toContain("no schedule");
    for (const row of CURRENT_RUN.slice(0, -1)) {
      expect(row.kind).toBe("renewed");
      expect(row.note).toMatch(/re-armed 0\.0\.\d+$/);
    }
  });

  it("arms a strictly increasing chain of schedule ids across the seven renewals", () => {
    const nums = CURRENT_RUN.slice(0, -1).map(r => Number(r.note.split("re-armed 0.0.")[1]));
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThan(nums[i - 1]);
  });

  it("charges a full renewal fee every time it re-arms, and a much smaller one on the period that lapses", () => {
    const hbarOf = (label: string) => Number(label.replace(" ℏ", ""));
    const renewals = CURRENT_RUN.slice(0, -1).map(r => hbarOf(r.feeLabel));
    const lapse = hbarOf(CURRENT_RUN[CURRENT_RUN.length - 1].feeLabel);
    for (const fee of renewals) expect(fee).toBeGreaterThan(1);
    // Arming the next schedule is what costs; the period that does not re-arm costs a fraction.
    expect(lapse).toBeLessThan(Math.min(...renewals) / 10);
  });

  it("headlines the first row of the run, not a different transaction", () => {
    expect(CURRENT_RENEWAL).toBe(CURRENT_RUN[0]);
    expect(CURRENT_RENEWAL.kind).toBe("renewed");
  });
});

describe("the disclosed revert and the settlement that opened the subscription", () => {
  it("places the reverted scheduled execution before the run it interrupted, and links it too", () => {
    expect(CURRENT_REVERT.error).toBe("Insolvent()");
    expect(CURRENT_REVERT.href).toBe(`${HASHSCAN}/transaction/${CURRENT_REVERT.consensus}`);
    expect(secondsOf(CURRENT_REVERT.consensus)).toBeLessThan(secondsOf(CURRENT_RUN[0].consensus));
    // It is disclosed as a limitation, so it must not also be counted as one of the successes.
    expect(CURRENT_RUN.map(r => r.consensus)).not.toContain(CURRENT_REVERT.consensus);
  });

  it("records the x402 settlement as a Hedera transaction id that predates every renewal it paid for", () => {
    expect(LIVE_SETTLEMENT).toMatch(/^\d+\.\d+\.\d+@\d+\.\d+$/);
    const paidAt = Number(LIVE_SETTLEMENT.split("@")[1]);
    expect(paidAt).toBeLessThan(secondsOf(CURRENT_REVERT.consensus));
    expect(paidAt).toBeLessThan(secondsOf(CURRENT_RUN[0].consensus));
  });

  it("names the chain of scheduled executions as a mirror-node transaction id", () => {
    expect(CURRENT_CHAIN_TX).toMatch(/^\d+\.\d+\.\d+-\d+-\d+$/);
  });
});

describe("the two deployments and the counters the page states out loud", () => {
  it("keeps the headline total equal to the per-contract breakdown it is summarising", () => {
    const sum = UNATTENDED_RENEWALS.byContract.reduce((a, b) => a + b, 0);
    expect(sum).toBe(UNATTENDED_RENEWALS.total);
    expect(UNATTENDED_RENEWALS.byContract).toHaveLength(UNATTENDED_RENEWALS.deployments);
    for (const count of UNATTENDED_RENEWALS.byContract) expect(count).toBeGreaterThan(0);
  });

  it("counts the first deployment's share as exactly the scheduled executions in the recorded run", () => {
    // 0.0.10406083 is the deployment RECORDED_RUN was transcribed from, so its counter is not an
    // independent number — it is the length of a table three screens further up this file.
    expect(UNATTENDED_RENEWALS.byContract[0]).toBe(RECORDED_RUN.filter(e => e.scheduled).length);
  });

  it("counts the current deployment's share as its eight-row run plus the one renewal that preceded the revert", () => {
    // The docblock on CURRENT_RUN says the network renewed once before the Insolvent() revert and
    // eight times after the re-arm. That "+1" is the only part of the total not visible in a table,
    // so it is pinned here rather than left to be re-derived by hand.
    expect(UNATTENDED_RENEWALS.byContract[UNATTENDED_RENEWALS.byContract.length - 1]).toBe(CURRENT_RUN.length + 1);
  });

  it("describes two distinct contracts, the current one funding longer periods than the recorded one", () => {
    expect(RECORDED_CONTRACT.id).not.toBe(CURRENT_CONTRACT.id);
    expect(RECORDED_CONTRACT.evm).not.toBe(CURRENT_CONTRACT.evm);
    for (const contract of [RECORDED_CONTRACT, CURRENT_CONTRACT]) {
      expect(contract.id).toMatch(/^0\.0\.\d+$/);
      expect(contract.evm).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(contract.periodSeconds).toBeGreaterThan(0);
    }
    // The deployments are listed oldest first, and the newer one is the one still running.
    expect(Number(CURRENT_CONTRACT.id.split(".")[2])).toBeGreaterThan(Number(RECORDED_CONTRACT.id.split(".")[2]));
    expect(CURRENT_CONTRACT.periodSeconds).toBeGreaterThan(RECORDED_CONTRACT.periodSeconds);
  });

  it("replays the recorded period in a whole number of seconds, which is what '10× time' has to mean", () => {
    expect(REPLAY_SPEED).toBeGreaterThan(1);
    expect(RECORDED_CONTRACT.periodSeconds % REPLAY_SPEED).toBe(0);
    expect(RECORDED_CONTRACT.periodSeconds / REPLAY_SPEED).toBe(6);
  });

  it("points every link at HashScan testnet, the network the run actually executed on", () => {
    expect(HASHSCAN).toBe("https://hashscan.io/testnet");
    const links = [...RECORDED_RUN.map(e => e.href), ...CURRENT_RUN.map(r => r.href), CURRENT_REVERT.href];
    for (const href of links) expect(href.startsWith(`${HASHSCAN}/transaction/`)).toBe(true);
  });
});
