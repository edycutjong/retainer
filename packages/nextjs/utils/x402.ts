/**
 * HBAR / tinybar helpers for the x402 pay-per-use template.
 *
 * Prices live on-chain in **tinybars** (1 HBAR = 1e8 tinybars), matching x402's
 * atomic-unit convention for native HBAR. The UI shows HBAR, so these helpers
 * convert between the two without floating-point drift.
 */

/** Tinybars in one HBAR. */
export const TINYBAR_PER_HBAR = 100_000_000n;

/**
 * Format a tinybar amount as a human-readable HBAR string (trailing zeros trimmed).
 *
 * @param tinybar - Amount in tinybars (bigint or decimal string).
 * @returns The amount in HBAR, e.g. `"1.5"` or `"0.001"`.
 */
export function formatTinybar(tinybar: bigint | string): string {
  const value = typeof tinybar === "bigint" ? tinybar : BigInt(tinybar);
  const whole = value / TINYBAR_PER_HBAR;
  const fraction = value % TINYBAR_PER_HBAR;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fractionStr}`;
}

/**
 * Parse a user-entered HBAR string into tinybars.
 *
 * @param hbar - HBAR amount as a string (e.g. `"1.5"`). Empty/invalid -> `0n`.
 * @returns The amount in tinybars.
 * @throws When more than 8 decimal places are supplied (sub-tinybar precision).
 */
export function hbarToTinybar(hbar: string): bigint {
  const trimmed = hbar.trim();
  if (!trimmed) return 0n;
  if (!/^\d*\.?\d*$/.test(trimmed)) throw new Error("Invalid HBAR amount");

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > 8) throw new Error("HBAR supports at most 8 decimal places");

  // `whole` still needs its fallback: ".5".split(".") is ["", "5"], and a destructuring
  // default only fires on undefined, not on "". `paddedFraction` needs none — padEnd(8, "0")
  // returns at least eight characters for every input the regex above admits.
  const paddedFraction = fraction.padEnd(8, "0");
  return BigInt(whole || "0") * TINYBAR_PER_HBAR + BigInt(paddedFraction);
}

/**
 * Weibar in one tinybar.
 *
 * Hedera has two denominations and the boundary is not where an Ethereum instinct puts it.
 * The JSON-RPC relay speaks **weibar** (1 HBAR = 1e18), so the `value` field of a transaction
 * you sign is 1e18-scaled. Inside the EVM everything is **tinybar** (1 HBAR = 1e8):
 * `msg.value`, `address(this).balance` and the `value` of an outbound `call{value:}` are all
 * tinybar. The relay converts at the edge.
 *
 * Measured, not assumed: `packages/hardhat/contracts/test/UnitProbe.sol` was deployed to
 * testnet and sent 2 HBAR as `2e18` on the wire. It reported `msg.value == 200000000`.
 *
 * Getting this wrong is silent in both directions — an extra factor overpays by ten orders of
 * magnitude and still looks like a successful transaction. So the conversion exists in exactly
 * one place, and `test/units.property.test.ts` verifies it across the whole range rather than
 * on an example.
 */
export const WEIBAR_PER_TINYBAR = 10n ** 10n;

/**
 * Scale a tinybar amount to the weibar `value` a JSON-RPC transaction carries.
 *
 * This is the ONLY conversion in the project. The contract does none: it receives tinybar and
 * it sends tinybar.
 */
export function tinybarToWeibar(tinybar: bigint): bigint {
  if (tinybar < 0n) throw new Error("tinybar amount cannot be negative");
  return tinybar * WEIBAR_PER_TINYBAR;
}

/**
 * Read a weibar wire amount back as the tinybar the EVM will see.
 *
 * Throws rather than truncating on a value that is not a whole number of tinybar. Silently
 * rounding here would be the same class of bug as the 1e10 overpay: wrong, and invisible.
 */
export function weibarToTinybar(weibar: bigint): bigint {
  if (weibar < 0n) throw new Error("weibar amount cannot be negative");
  if (weibar % WEIBAR_PER_TINYBAR !== 0n) {
    throw new Error(`${weibar} weibar is not a whole number of tinybar`);
  }
  return weibar / WEIBAR_PER_TINYBAR;
}
