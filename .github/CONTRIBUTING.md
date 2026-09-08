# Contributing

Thanks for your interest in Retainer. 🔁

This is a hackathon submission built for [ETHGlobal ETHOnline 2026](https://ethglobal.com/events/ethonline2026),
so the tree is frozen around a judged artifact. Bug reports and small, focused fixes are very
welcome; large refactors are unlikely to be merged while judging is open.

## Getting started

```bash
git clone https://github.com/edycutjong/retainer.git
cd retainer
yarn install

cp packages/hardhat/.env.example packages/hardhat/.env
cp packages/nextjs/.env.example  packages/nextjs/.env

yarn hardhat:compile
yarn next:dev
```

You need Node.js ≥ 20.18.3, Yarn 3 via Corepack, and — if you want to touch the chain path —
a funded **ECDSA** Hedera testnet account from the [Hedera Portal](https://portal.hedera.com/).
ECDSA is required; x402 on Hedera does not work with an ED25519 key.

Reading the code and running the unit tests needs none of that.

## Before you open a PR

```bash
yarn ci     # compile + contract tests + unit tests + both lints + both typechecks
yarn e2e    # Playwright, against a local production build — no keys needed
```

- Add or update a test for any behavior change.
- If you fix a defect, **name the test after the defect**, not after the function
  (`renewal_refills_the_meter_not_just_the_window`, not `test_renew_3`). The test list is
  meant to read as a changelog of real bugs found.
- Never commit a secret. Credentials belong in `~/.config/retainer/`, never in the tree.
  `.github/workflows/gitleaks.yaml` scans full history and will catch it.

## Commit messages

Commits here are written as sentences that explain **why**, not what — the history is part of
what is judged. `Fix four money bugs and wire x402 settlement into the subscription` is the
house style; `fix: bugs` is not.

## Reporting bugs / requesting features

Open an issue using the templates in `.github/ISSUE_TEMPLATE/`. For anything with a security
impact, follow [SECURITY.md](SECURITY.md) instead — do not open a public issue.
