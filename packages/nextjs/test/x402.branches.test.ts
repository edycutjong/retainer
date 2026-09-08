import { describe, expect, it } from "vitest";
import { formatTinybar, hbarToTinybar } from "~~/utils/x402";

/**
 * The two doors into the unit helpers that `units.property.test.ts` never opens.
 *
 * That suite proves the arithmetic across 202,059 amounts, but it only ever hands `formatTinybar`
 * a `bigint` and only ever hands `hbarToTinybar` a string that `formatTinybar` itself produced.
 * Neither is how the running product calls them:
 *
 *   - Every tinybar amount that reaches the UI has been through JSON. `/api/retainer/status`
 *     serialises `pricePerPeriodTinybar` and `balanceTinybar` as **strings**, because a uint256
 *     does not survive `JSON.stringify`. So the string arm is the arm production uses.
 *   - Every HBAR amount that reaches `hbarToTinybar` was typed by a person, and a person typing
 *     an amount below one HBAR very often omits the leading zero: `.5`, not `0.5`.
 *
 * Both are one-line fallbacks, and both fail silently if they break — a thrown `SyntaxError` on a
 * price read, or a period priced at zero. This file pins them.
 */

describe("formatTinybar — the string arm, which is the one the UI actually uses", () => {
  it("accepts the decimal string JSON delivers and agrees, digit for digit, with the bigint arm", () => {
    // The API can only send a uint256 as a string, so this arm is not a convenience: it is the
    // path every price on the page takes. Disagreeing with the bigint arm would mean the number
    // shown to a buyer and the number checked on chain came from different code.
    for (const tinybar of [0n, 1n, 50_000_000n, 100_000_000n, 110_000_000n, 2n ** 64n - 1n]) {
      expect(formatTinybar(tinybar.toString())).toBe(formatTinybar(tinybar));
    }
    expect(formatTinybar("100000000")).toBe("1");
    expect(formatTinybar("1")).toBe("0.00000001");
  });

  it("refuses a string that is not a whole number of tinybar instead of truncating it to one", () => {
    // `BigInt("1.5")` throws, and that is the wanted behaviour: an HBAR-shaped string arriving
    // where a tinybar amount belongs is a caller confusing the two denominations by 1e8. Rounding
    // it would mis-price by that factor and look entirely normal.
    expect(() => formatTinybar("1.5")).toThrow(SyntaxError);
    expect(() => formatTinybar("0.00000001")).toThrow(SyntaxError);
    expect(() => formatTinybar("abc")).toThrow(SyntaxError);
  });

  it('renders an empty string as zero, because `BigInt("")` is `0n` and a missing price is not a crash', () => {
    // Not obviously right, but it is the behaviour, and it is the safe one: a status read that
    // omitted the field renders "0 HBAR" rather than throwing inside a render pass.
    expect(formatTinybar("")).toBe("0");
  });
});

describe("hbarToTinybar — an amount typed without its leading zero", () => {
  it("reads `.5` as half an HBAR, the way a keyboard produces it", () => {
    // Splitting ".5" on "." yields ["", "5"]: the whole part is an empty string, not `undefined`,
    // so the destructuring default never fires and the `|| "0"` is what keeps this from throwing.
    expect(hbarToTinybar(".5")).toBe(50_000_000n);
    expect(hbarToTinybar(".5")).toBe(hbarToTinybar("0.5"));
    expect(hbarToTinybar(".00000001")).toBe(1n);
    expect(hbarToTinybar(".00000001")).toBe(hbarToTinybar("0.00000001"));
  });

  it("prices a lone decimal point at nothing rather than throwing, so a half-typed amount is inert", () => {
    // A field mid-keystroke holds "." for as long as it takes to type the next digit. Zero is the
    // safe reading: an empty order, not an exception thrown at whoever is watching the form.
    expect(hbarToTinybar(".")).toBe(0n);
    expect(hbarToTinybar(".")).toBe(hbarToTinybar(""));
  });

  it("still enforces the eight-decimal limit on an amount typed without its leading zero", () => {
    expect(() => hbarToTinybar(".000000001")).toThrow(/at most 8 decimal places/);
  });
});
