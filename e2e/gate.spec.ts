import { expect, test } from "@playwright/test";

/**
 * The gate's contract, asserted without spending anything.
 *
 * The most valuable thing to test about a paywall is not that it can be paid — that is proven
 * on the real network in `docs/proof.md`. It is that it **fails closed**: when the seller
 * account is not configured, or the chain read fails, or the address is nonsense, the resource
 * must not come out anyway.
 *
 * These run with an empty environment, which is exactly the misconfiguration being checked.
 */

const COLD_AGENT = "0x0000000000000000000000000000000000000abc";

test.describe("input validation — the same answer for every malformed request", () => {
  test("the gate refuses a request with no agent", async ({ request }) => {
    const response = await request.get("/api/retainer/access");
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("Provide ?agent=");
  });

  test("the gate refuses an agent that is not an EVM address", async ({ request }) => {
    const response = await request.get("/api/retainer/access?agent=not-an-address");
    expect(response.status()).toBe(400);
  });

  test("the read-only status route refuses a request with no agent", async ({ request }) => {
    const response = await request.get("/api/retainer/status");
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("Provide ?agent=");
  });

  test("the read-only status route refuses an agent that is not an EVM address", async ({ request }) => {
    const response = await request.get("/api/retainer/status?agent=0xnope");
    expect(response.status()).toBe(400);
  });
});

test.describe("fail closed — an unpaid agent never receives the resource", () => {
  test("a cold agent is never served, whatever goes wrong upstream", async ({ request }) => {
    const response = await request.get(`/api/retainer/access?agent=${COLD_AGENT}`);

    // Any of these is a correct refusal:
    //   402  the challenge was built and the agent must pay        (fully configured)
    //   500  RETAINER_PAY_TO is not set, so nothing can be charged (this suite's environment)
    //   502  the on-chain read failed
    //   503  RetainerAccess is not deployed on the target network
    // The only forbidden answer is 200. Serving a cold agent for free is the single failure
    // that would make the whole project a lie, so it is asserted directly rather than implied.
    expect(response.status()).not.toBe(200);
    expect([402, 500, 502, 503]).toContain(response.status());

    // `resource` in a 402 body is the x402 *description* of what is for sale, not the data
    // itself. The thing that must never appear is the served feed — a quoted rate — or an
    // access grant, or an on-chain metering record.
    const body = await response.json();
    expect(body.access).not.toBe("granted");
    expect(body.metering).toBeUndefined();
    expect(body.resource?.rate).toBeUndefined();
    expect(body.resource?.pair).toBeUndefined();
  });
});

/**
 * The live gate, against the deployed service. Opt-in, because a test that depends on a third
 * party's uptime should never be able to fail someone else's pull request.
 *
 *   E2E_LIVE_BASE_URL=https://retainer-plum.vercel.app yarn e2e
 *
 * The production deploy workflow runs the equivalent check on every push and refuses to promote
 * a build whose gate has stopped answering, so this is a manual double-check, not the guard.
 */
const liveBase = process.env.E2E_LIVE_BASE_URL;

test.describe("live gate (opt-in)", () => {
  test.skip(!liveBase, "set E2E_LIVE_BASE_URL to check the deployed service");

  test("the deployed gate challenges a cold agent on hedera:testnet", async ({ request }) => {
    const response = await request.get(`${liveBase}/api/retainer/access?agent=${COLD_AGENT}`);
    expect(response.status()).toBe(402);
    expect(JSON.stringify(await response.json())).toContain("hedera:testnet");
    expect(response.headers()["payment-required"]).toBeTruthy();
  });
});
