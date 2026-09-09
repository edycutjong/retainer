import styles from "./judge.module.css";
import type { Metadata } from "next";

/**
 * `/judge` — the one surface built for a single reader.
 *
 * Someone triaging a large field of submissions will not clone a repo, will not read a test
 * suite, and may never reach the README. This page is the claim, the exact clicks that prove
 * it, the receipts, and the limitations — with no account, no key, no setup, and no auth in
 * front of any of it.
 *
 * It is a static server component on purpose: it renders even if Hedera, the facilitator or
 * the RPC endpoint are unreachable, because a judge surface that can 500 is worse than none.
 * Everything dynamic is a link out to the live routes or to HashScan, so nothing on this page
 * can go stale into a lie.
 *
 * It mirrors JUDGE.md in the repository root. Keep the two in step.
 */

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "For judges",
  description:
    "Retainer in 30 seconds: the claim, the exact commands that prove it against Hedera testnet, the measured costs, and the honest limitations.",
};

const AGENT_COLD = "0x0000000000000000000000000000000000000abc";
const AGENT_LIVE = "0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66";
const BASE = "https://retainer.edycu.dev";
const CONTRACT_ID = "0.0.10415845";
const CONTRACT_EVM = "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931";
/** The first of eight renewals the network executed by itself on the current deployment (2026-09-08). */
const RENEWAL_TS = "1788844334.069565823";
/** Every one of those eight, plus the ordinary renew() that armed the first, share this transaction id. */
const CURRENT_CHAIN_TX = "0.0.7314364-1788844238-651641588";
/** The scheduled execution on the current deployment that reverted — limitation 3. */
const REVERT_TS = "1788840415.078121802";
const REPO = "https://github.com/edycutjong/retainer";

const receipts: [string, React.ReactNode][] = [
  [
    "x402 payment settled through Blocky402",
    <>
      <code key="p">0.0.7162784@1788840225.936068496</code> — 3 HBAR, agent → seller, fee paid by the facilitator; it
      opened the current deployment&rsquo;s subscription
    </>,
  ],
  [
    "Unattended renewals executed by the network",
    <>
      <strong>19</strong> across three deployments (3 · 7 · 9), every one <code>CONTRACTCALL</code>{" "}
      <code>scheduled=true</code> <code>SUCCESS</code> with a <code>Renewed</code> event. One further scheduled
      execution reverted — limitation 3.
    </>,
  ],
  [
    "Cost of one self-re-arming renewal",
    <>
      <strong key="a">1.54896 HBAR</strong> on the first deployment; <strong>1.54036 HBAR</strong> on the current one
    </>,
  ],
  [
    "Cost of a renewal that does not re-arm",
    <>
      <strong key="b">0.0507 HBAR</strong> on the first deployment; <strong>0.0522 HBAR</strong> on the current one
    </>,
  ],
  [
    "What that ~30× gap proves",
    <>
      re-arming — the <code>scheduleCall</code> into <code>0x16b</code> — is <strong>~97%</strong> of what a renewal
      costs, on both deployments
    </>,
  ],
  ["Gas used, subscribe() on testnet", "1,582,554 (limit 2,000,000)"],
  ["Gas used, deploy", "968,564"],
  [
    "Contract tests",
    <>
      <strong>46 passing</strong> — <code>yarn hardhat:test</code>
    </>,
  ],
  [
    "Resource-server unit tests",
    <>
      <strong>10 passing</strong> — <code>yarn next:test</code>
    </>,
  ],
  [
    "Amounts checked across the unit boundary",
    <>
      <strong>202,059</strong>, three invariants each = 606,177 assertions
    </>,
  ],
  [
    "Hedera Schedule Service methods used",
    <>
      3, all load-bearing: <code>scheduleCall</code>, <code>hasScheduleCapacity</code>, <code>deleteSchedule</code>
    </>,
  ],
];

const links: [string, string][] = [
  ["Live app", BASE],
  ["Repository", REPO],
  ["Contract on HashScan", `https://hashscan.io/testnet/contract/${CONTRACT_ID}`],
  ["On-chain proof, with re-verify commands", `${REPO}/blob/main/docs/proof.md`],
  ["The OpenAPI document the MCP tools are generated from", `${BASE}/openapi.json`],
  ["What an unattended renewal costs", `${REPO}/blob/main/docs/gas-economics.md`],
  ["The unit trap, measured", `${REPO}/blob/main/docs/hedera-units.md`],
  ["Architecture", `${REPO}/blob/main/specs/architecture.md`],
  ["How AI was used, per file", `${REPO}/blob/main/AI-USAGE.md`],
  ["Security properties, each next to its test", `${REPO}/blob/main/.github/SECURITY.md`],
];

export default function JudgePage() {
  return (
    <div className={styles.page} data-testid="judge">
      <p className={styles.eyebrow}>Retainer · for judges · 30 seconds</p>

      <h1 className={styles.claim}>Your agent&rsquo;s access renews itself on-chain at 3am, with nobody awake.</h1>

      <p className={styles.lede} data-testid="judge-lede">
        An x402-gated metered data feed on Hedera whose access window is an on-chain subscription that the{" "}
        <strong>Hedera Schedule Service</strong> (HIP-1215, system contract <code>0x16b</code>) extends by itself. The
        agent signs exactly one thing — the first payment. Nothing signs anything again.
      </p>

      <div className={styles.note}>
        <p>
          Nothing on this page needs an account, a key, or a clone. Every command below runs against the live deployment
          and the real Hedera testnet. There is no offline, mock or demo mode for the product.
        </p>
      </div>

      <h2>The 30-second path</h2>

      <ol className={styles.steps}>
        <li>
          <h3>Watch a cold agent get charged.</h3>
          <pre className={styles.pre}>
            <code>{`curl -i "${BASE}/api/retainer/access?agent=${AGENT_COLD}"`}</code>
          </pre>
          <p>
            You get <strong>402 Payment Required</strong> with a real x402 challenge — <code>scheme: exact</code>,{" "}
            <code>network: hedera:testnet</code>, native HBAR — in the body <em>and</em> verbatim in the{" "}
            <code>PAYMENT-REQUIRED</code> header, so an ordinary x402 client can parse it. That is the gate refusing
            service.
          </p>
        </li>

        <li>
          <h3>Read an agent that has paid before.</h3>
          <pre className={styles.pre}>
            <code>{`curl -s "${BASE}/api/retainer/status?agent=${AGENT_LIVE}"`}</code>
          </pre>
          <p>
            No 402. Whatever the chain says about this agent right now — window open, or lapsed with{" "}
            <code>balanceTinybar: &quot;0&quot;</code> after its last run ended — the balance, the metered allowance and
            the address of any <em>pending scheduled renewal</em> come straight off the contract. Nothing here is served
            from a database, and nothing is made to look alive.
          </p>
        </li>

        <li>
          <h3>Check that on Hedera yourself, not on our word.</h3>
          <ul className={styles.list}>
            <li>
              The contract the server just read:{" "}
              <a href={`https://hashscan.io/testnet/contract/${CONTRACT_ID}`}>{CONTRACT_ID}</a> —{" "}
              <code>{CONTRACT_EVM}</code>
            </li>
            <li>
              One renewal the <strong>network executed on its own</strong> — <code>CONTRACTCALL</code>,{" "}
              <code>scheduled=true</code>, <code>SUCCESS</code>:{" "}
              <a href={`https://hashscan.io/testnet/transaction/${RENEWAL_TS}`}>{RENEWAL_TS}</a>. No transaction was
              sent to trigger it. It is the first of eight in a row; all eight, and the one ordinary call that armed the
              first, come back from one mirror-node request:
            </li>
          </ul>
          <pre className={styles.pre}>
            <code>{`curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/${CURRENT_CHAIN_TX}" \\
  | jq -r '.transactions[] | [.consensus_timestamp, .name, "scheduled=\\(.scheduled)", .result, "fee=\\(.charged_tx_fee)"] | @tsv'`}</code>
          </pre>
        </li>

        <li>
          <h3>Open the live view.</h3>
          <p>
            <a href={BASE}>{BASE}</a> — paste an agent address and watch the window count down and then jump back up on
            its own. Every number on it is a chain read via <code>/api/retainer/status</code>.
          </p>
        </li>
      </ol>

      <p>
        That is the whole product. Steps 1 and 2 are the two halves of the claim; step 3 is the part nobody has to trust
        us for.
      </p>

      <h2>The receipt block</h2>

      <p>
        Real numbers from real runs, not estimates. Every one is re-verifiable against the public Hedera mirror node —
        the exact <code>curl</code> commands are in <a href={`${REPO}/blob/main/docs/proof.md`}>docs/proof.md</a>.
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            {receipts.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        The number worth ten seconds of attention is the 1.54896-vs-0.0507 split. It is the same function executing
        twice, and it is the whole cost story of unattended on-chain renewal — see{" "}
        <a href={`${REPO}/blob/main/docs/gas-economics.md`}>docs/gas-economics.md</a>.
      </p>

      <h2>Reproduce it</h2>

      <h3>The real path — this is the product</h3>
      <p>
        Hits the live server and the real chain. It needs a funded ECDSA Hedera testnet account in{" "}
        <code>~/.config/retainer/hedera.env</code> (<code>BUYER_PRIVATE_KEY</code>, <code>BUYER_ACCOUNT_ID</code>);
        credentials never live in the repo.
      </p>
      <pre className={styles.pre}>
        <code>{`git clone ${REPO}.git && cd retainer && yarn install
cd packages/nextjs
BASE_URL=${BASE} yarn tsx scripts/retainer-agent.ts`}</code>
      </pre>
      <p>
        Cold request → 402 → pay once over x402 → the server forwards that settled payment into{" "}
        <code>subscribeFor</code> → the same request again, now 200 with <code>paidThisRequest:false</code> →{" "}
        <strong>wait past expiry sending nothing</strong> → 200 again. The last step is the claim. A recorded run of
        exactly this is at the end of <a href={`${REPO}/blob/main/docs/proof.md`}>docs/proof.md</a>.
      </p>

      <h3>The deterministic replay — CI only, never the demo</h3>
      <p>
        This does <em>not</em> exercise the Schedule Service; it runs against <code>MockScheduleService.sol</code>,
        because a Hardhat node has no system contract at <code>0x16b</code>. It proves the contract logic, not the
        network behaviour.
      </p>
      <pre className={styles.pre}>
        <code>{`yarn hardhat:test     # 46 contract tests
yarn next:test        # 10 unit tests, 202,059 amounts across the unit boundary`}</code>
      </pre>

      <h2>Honest limitations</h2>

      <p>Four real ones. None of them is fixed here.</p>

      <ol className={styles.list}>
        <li>
          <strong>At the default price, Retainer loses money on every renewal.</strong> A renewal burns ~1.55 HBAR of
          the seller&rsquo;s gas reserve to collect 1 HBAR of revenue. That is not a bug in the code — it is the actual
          economics of on-chain self-renewal at this gas limit, and pricing a period above the renewal cost is a product
          decision this build did not make.
        </li>
        <li>
          <strong>The metering write is fire-and-forget.</strong> The allowance is <em>enforced</em> by simulating{" "}
          <code>meter()</code> against current chain state, but the recording transaction is not awaited — waiting put
          Hedera finality inside a serverless request and timed it out. A burst of requests arriving within the same few
          seconds can therefore overshoot the allowance by roughly the number in flight. Bounded, small, and disclosed
          rather than discovered.
        </li>
        <li>
          <strong>One scheduled renewal on the deployed source reverted.</strong> At{" "}
          <a href={`https://hashscan.io/testnet/transaction/${REVERT_TS}`}>{REVERT_TS}</a> the network fired{" "}
          <code>renew()</code> on <code>{CONTRACT_ID}</code> and the call came back{" "}
          <code>CONTRACT_REVERT_EXECUTED</code> with the contract&rsquo;s own <code>Insolvent()</code> guard — the check
          that the three money pots never exceed <code>address(this).balance</code>. The account&rsquo;s real balance at
          that second, reconstructed from the mirror node, was 2,139,131,760 tinybar against pots totalling
          1,900,000,000, so the balance the EVM exposed <em>during</em> the scheduled execution was lower than the
          account&rsquo;s — consistent with Hedera reserving the call&rsquo;s full gas cost on the payer before it runs.
          The subscription was restarted by hand (<code>creditFor</code>, then one ordinary <code>renew()</code>) and
          the network then executed eight renewals unattended to a loud lapse. The guard is right to exist and wrong to
          count that reservation; the fix needs a redeploy and is not made here. Three deployments exist —{" "}
          <code>0.0.10406083</code>, <code>0.0.10414167</code>, <code>{CONTRACT_ID}</code> — and{" "}
          <a href={`${REPO}/blob/main/docs/proof.md`}>docs/proof.md</a> keeps them apart.
        </li>
        <li>
          <strong>A lapsed subscription cannot restart itself.</strong> Lapsing is loud — every ending carries a{" "}
          <code>Lapsed</code> event with a reason string — but once <code>active</code> is false the contract will not
          re-arm. <code>renew(agent)</code> reverts <code>NotSubscribed()</code> (an <code>eth_call</code> against the
          live contract for a lapsed agent returns <code>0x237e6c28</code>, that error&rsquo;s selector) and{" "}
          <code>fund()</code> only credits the subscriber&rsquo;s balance; neither schedules anything. Opening a
          subscription again is the only way back — <code>subscribe()</code>, or the <code>subscribeFor()</code> the
          server calls when the agent pays the next 402. So the unattended part runs exactly as far as the money does:
          until the subscriber&rsquo;s balance or the seller&rsquo;s gas reserve runs dry, and then someone outside has
          to send a transaction. At the demo settings — 90-second periods, 2 ℏ held back per armed renewal — that is
          minutes, not months.
        </li>
      </ol>

      <p>
        Also true: not audited, testnet only, and <code>RENEWAL_COST_ESTIMATE</code> is an explicit estimate — a
        contract cannot know a future network fee.
      </p>

      <h2>Links</h2>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            {links.map(([label, href]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>
                  <a href={href}>{href}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.footerNote}>
        This page mirrors <code>JUDGE.md</code> in the repository root. Built for ETHGlobal ETHOnline 2026, targeting
        Hedera&rsquo;s AI &amp; Agentic Payments bounty.
      </p>
    </div>
  );
}
