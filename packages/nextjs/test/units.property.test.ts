import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { WEIBAR_PER_TINYBAR, formatTinybar, hbarToTinybar, tinybarToWeibar, weibarToTinybar } from "~~/utils/x402";

/**
 * The one thing in this project that must never be wrong.
 *
 * Hedera money crosses two unit boundaries, and both failures are silent:
 *
 *   1. **wire ↔ EVM.** The JSON-RPC relay speaks weibar (1 HBAR = 1e18); inside the EVM
 *      `msg.value` is tinybar (1 HBAR = 1e8). Applying the 1e10 factor twice overpays by ten
 *      orders of magnitude and still returns a successful transaction receipt. Omitting one
 *      that is genuinely needed underpays by the same factor.
 *   2. **tinybar ↔ human HBAR.** The display/parse pair. Drift here misprices the product.
 *
 * Examples are not enough for arithmetic whose failure mode is "looks fine, off by 1e10", so
 * this file verifies the boundaries across a range instead of at a handful of points.
 *
 * ── The number this suite publishes ─────────────────────────────────────────────────────────
 *
 *   exhaustive, sub-HBAR band          0 .. 100_000                     100_001 amounts
 *   exhaustive, across the 1 HBAR seam 99_999_000 .. 100_001_000          2_001 amounts
 *   exhaustive, every decade edge      10^k − 1, 10^k, 10^k + 1 (k≤18)       57 amounts
 *   randomised, full uint64 range      fast-check                        100_000 amounts
 *                                                                       ───────────────
 *                                                                       202_059 amounts
 *
 * Every one of them is checked against all three invariants below, so the suite makes
 * 606,177 assertions about the unit boundary. Zero of them lose or invent a tinybar.
 */

const EXHAUSTIVE_LOW_MAX = 100_000n;
const SEAM_LO = 99_999_000n;
const SEAM_HI = 100_001_000n;
const RANDOM_RUNS = 100_000;

/** Every invariant the unit boundary has to hold, applied to one amount. */
function checkAmount(tinybar: bigint) {
  // 1. wire round trip: tinybar -> weibar -> tinybar is the identity, exactly.
  const weibar = tinybarToWeibar(tinybar);
  expect(weibar).toBe(tinybar * WEIBAR_PER_TINYBAR);
  expect(weibarToTinybar(weibar)).toBe(tinybar);

  // 2. display round trip: tinybar -> "H.BBBBBBBB" -> tinybar is the identity.
  //    `formatTinybar` (bigint -> string, padStart + trailing-zero trim) and `hbarToTinybar`
  //    (string -> bigint, split + padEnd) are independently written code paths, so agreeing
  //    is evidence rather than tautology.
  const hbar = formatTinybar(tinybar);
  expect(hbarToTinybar(hbar)).toBe(tinybar);

  // 3. no sub-tinybar precision is ever emitted. HBAR has exactly 8 decimal places; a ninth
  //    would mean the formatter invented value the chain cannot represent.
  const fraction = hbar.includes(".") ? hbar.split(".")[1] : "";
  expect(fraction.length).toBeLessThanOrEqual(8);
}

describe("the unit boundary — verified across a range, not at examples", () => {
  it("holds for every tinybar amount from 0 to 100,000 (100,001 amounts, exhaustive)", () => {
    let checked = 0n;
    for (let t = 0n; t <= EXHAUSTIVE_LOW_MAX; t++) {
      checkAmount(t);
      checked++;
    }
    expect(checked).toBe(100_001n);
  });

  it("holds across the 1 HBAR seam where the whole/fraction split flips (2,001 amounts, exhaustive)", () => {
    let checked = 0n;
    for (let t = SEAM_LO; t <= SEAM_HI; t++) {
      checkAmount(t);
      checked++;
    }
    expect(checked).toBe(2_001n);
  });

  it("holds at every decade edge up to 1e18, including the 1e10 weibar factor itself (57 amounts, exhaustive)", () => {
    const edges: bigint[] = [];
    for (let k = 0; k <= 18; k++) {
      const decade = 10n ** BigInt(k);
      edges.push(decade - 1n, decade, decade + 1n);
    }
    for (const t of edges) checkAmount(t);
    expect(edges.length).toBe(57);
  });

  it("holds for 100,000 randomised amounts across the whole uint64 range", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), t => {
        checkAmount(t);
        return true;
      }),
      { numRuns: RANDOM_RUNS },
    );
  });
});

/**
 * Regression tests, each named after the defect it pins rather than the function it calls.
 * The list is meant to read as a changelog of bugs this project actually had.
 */
describe("regressions — named for the defect, not the function", () => {
  it("defect: the 1e10 conversion was applied inside the contract as well as on the wire, overpaying by ten orders of magnitude", () => {
    // UnitProbe.sol, deployed to testnet, was sent 2 HBAR as 2e18 on the wire and reported
    // msg.value == 200000000. That measurement is the oracle for this assertion.
    const twoHbarTinybar = 200_000_000n;
    expect(tinybarToWeibar(twoHbarTinybar)).toBe(2n * 10n ** 18n);
    expect(weibarToTinybar(2n * 10n ** 18n)).toBe(twoHbarTinybar);
    // The bug: converting a second time. Guard the magnitude explicitly so a reintroduced
    // conversion fails loudly here instead of on testnet.
    expect(tinybarToWeibar(twoHbarTinybar)).not.toBe(twoHbarTinybar * WEIBAR_PER_TINYBAR * WEIBAR_PER_TINYBAR);
  });

  it("defect: a weibar value that is not a whole number of tinybar was silently truncated instead of refused", () => {
    expect(() => weibarToTinybar(WEIBAR_PER_TINYBAR + 1n)).toThrow(/not a whole number of tinybar/);
    expect(() => weibarToTinybar(1n)).toThrow(/not a whole number of tinybar/);
  });

  it("defect: a negative amount was scaled rather than rejected, turning an underflow into a transfer", () => {
    expect(() => tinybarToWeibar(-1n)).toThrow(/negative/);
    expect(() => weibarToTinybar(-WEIBAR_PER_TINYBAR)).toThrow(/negative/);
  });

  it("defect: trailing-zero trimming dropped the whole fraction, so 1.10 HBAR formatted as 1.1 and 1.00000000 as 1.", () => {
    expect(formatTinybar(110_000_000n)).toBe("1.1");
    expect(formatTinybar(100_000_000n)).toBe("1");
    expect(formatTinybar(0n)).toBe("0");
    expect(formatTinybar(1n)).toBe("0.00000001");
  });

  it("defect: sub-tinybar input was accepted and rounded, inventing precision the chain cannot hold", () => {
    expect(() => hbarToTinybar("0.000000001")).toThrow(/at most 8 decimal places/);
    expect(hbarToTinybar("0.00000001")).toBe(1n);
  });

  it("defect: a malformed HBAR string parsed as 0 instead of failing, silently pricing a period at nothing", () => {
    expect(() => hbarToTinybar("1.2.3")).toThrow(/Invalid HBAR amount/);
    expect(() => hbarToTinybar("abc")).toThrow(/Invalid HBAR amount/);
    expect(hbarToTinybar("")).toBe(0n);
  });
});
