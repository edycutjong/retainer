# Security Policy

## Scope

This repository contains a smart contract (`packages/hardhat/contracts/RetainerAccess.sol`)
deployed to **Hedera testnet only**, and a Next.js resource server that holds a seller key.
Nothing here has been audited, and it holds no mainnet value. Treat it as a hackathon
artifact, not production money infrastructure.

## Supported versions

| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability. Instead:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  (Security → Report a vulnerability).

You will get an acknowledgment within 48 hours and a resolution timeline after triage. Please
allow a reasonable window to patch before public disclosure.

## Security properties this project actually asserts

These are claims backed by tests in `packages/hardhat/test/RetainerAccess.test.ts`, not
aspirations. Each bullet names the test that pins it.

- **The seller cannot spend subscriber money.** `withdraw()` is bounded by `revenue`; the
  `_owed` and `gasReserve` pots are unreachable from it.
  → *"the beneficiary cannot withdraw subscriber money"*,
  *"the beneficiary cannot withdraw the gas reserve"*
- **Only the beneficiary may withdraw, set terms, sync the reserve, or move the meter.**
  → *"only the beneficiary may withdraw"*, *"only the beneficiary may change the terms"*,
  *"only the beneficiary may sync the reserve"*, *"only the seller may move the meter"*
- **`renew()` is public but not free to abuse.** It is gated on the window having expired, and
  `MIN_PERIOD_SECONDS = 61 > 2 × RENEW_SLACK` keeps that gate a strict minority of every
  period, so a stranger cannot loop it to burn the seller's gas reserve.
  → *"a stranger cannot repeatedly force renewals to drain the contract"*,
  *"rejects a period short enough to keep the renew() window permanently open"*
- **`subscribeFor()` cannot be used to grief an agent.** The caller must fund a full period
  themselves, so a stranger can only make a subscription a gift — never spend the agent's
  existing balance or the seller's reserve on a subscription the agent did not ask for.
  → *"subscribeFor cannot spend an agent's existing balance without funding a period"*
- **subscribe → cancel churn does not drain the reserve.** `cancel()` deletes the pending
  schedule and returns its reserved gas.
  → *"subscribe→cancel churn does not drain the gas reserve"*
- **The contract is always solvent.** `_solvent()` asserts
  `address(this).balance >= _owed + revenue + gasReserve` at the end of every call that moves
  money out of a pot.
  → *"holds the solvency invariant: balance covers all three pots"*

## Known limitations (disclosed, not fixed)

- **The metering write is fire-and-forget.** `meterCall()` enforces the allowance by
  simulating `meter()` against current chain state, then sends the recording transaction
  without awaiting the receipt. Requests arriving inside the same few seconds can therefore
  each simulate against the same pre-write state, so a burst can overshoot the allowance by
  roughly the number of requests in flight. Bounded and small; the alternative was a
  serverless endpoint that times out on Hedera finality.
- **`RENEWAL_COST_ESTIMATE` is an estimate.** A contract cannot know a future network fee. It
  is set at 2 HBAR against a measured 1.549 HBAR to carry headroom for gas-price movement.
- **Not audited.** No formal review, no bug bounty, testnet only.

## Dependency alerts — what the count means

Dependabot alerts, automated security fixes, and secret scanning with push protection are all
enabled on this repository, and the alert count is not small. That is worth explaining rather
than hiding, because the number is a fact anyone can see.

This repo was built from [`hedera-dev/scaffold-hbar`](https://github.com/hedera-dev/scaffold-hbar),
whose wallet stack (`@reown/appkit`, `@walletconnect/*`, `@hiero-ledger/sdk`, `wagmi`) pulls in
a very large transitive tree. Nearly every open alert is a transitive dependency of that tree
or of the build tooling — `axios`, `protobufjs`, `handlebars`, `tar`, `undici`, `ws` — reached
through paths that this project's own code does not call.

What is deliberate about how that is handled:

- **Alerts are on, not silenced.** Turning them off would make the security tab look better and
  the repository less safe. The count is the honest state of an inherited dependency tree.
- **Dependabot is grouped, monthly, and ignores majors** (`.github/dependabot.yml`). Security
  updates are a *separate channel* from version updates and are unaffected by that config: they
  still open PRs. The version-update throttle exists because this repo is a judged artifact
  pointing at a live deploy and a deployed contract, and a `next` 15→16 PR merged unattended
  would break exactly the thing being judged.
- **The high-value surface is small and is tested.** The money logic is
  `RetainerAccess.sol` — Solidity, no npm dependencies except OpenZeppelin and the Hedera
  system-contract interfaces — plus two API routes. That is what the tests above cover.
- **Nothing here holds mainnet value.** Testnet only, unaudited, by design for a hackathon.

A mass lockfile remediation across that tree is a real piece of work with a real chance of
breaking the live deploy, and doing it in the days before a submission deadline would trade a
cosmetic improvement for the risk of a broken demo. It is listed here as known and outstanding
rather than quietly closed.

## Secrets

Credentials for this project live outside the repository, in `~/.config/retainer/`. No key,
mnemonic, or account id belongs in the tree. `.github/workflows/gitleaks.yaml` scans the full
git history on every push for exactly this.
