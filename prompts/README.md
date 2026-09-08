# Prompts

ETHGlobal requires *"all spec files, prompts, and planning artifacts"* in the submission
repository when a spec-driven workflow is used, so judges can see how the AI was directed.
This directory is that record.

## How to read these files — one caveat, stated up front

**These are reconstructed records of the direction given at each step, written against the
commit history — not a verbatim keystroke log of the chat.** They were written after the
fact, in one pass, by reading `git log` and the diff of each commit and setting down what was
asked for, why it was asked for at that moment, and which commit it produced. The wording is
therefore a faithful summary rather than a transcript.

Saying that plainly is better than presenting a polished transcript that was never typed.
What *is* verbatim, and what judges should treat as the primary evidence, is the commit
history itself: each commit message states what changed and why, and every claim in these
files is checkable against the diff named at the top of it.

Where a later step proved an earlier one wrong, the earlier file keeps what it said and carries
a dated correction pointing forward — see the correction in `08-money-bugs-and-creditfor.md`,
which `11-units-measured-not-assumed.md` overturned. Editing step 08 into having been right
would remove the only interesting thing about that pair.

## Index

| File | Step | Commit |
|---|---|---|
| `01-track-and-self-renewal-angle.md` | Pick the Hedera x402 track and the angle | — (pre-code) |
| `02-facilitator-spike-and-scaffold-import.md` | Prove Blocky402 works, import the starter | `4a0ddc3` |
| `03-blocky402-as-the-real-default.md` | Audit fix: the docs claimed a change that was not made | `8243c11` |
| `04-retainer-access-contract.md` | Build the self-renewing contract, prove it on testnet | `fefd461` |
| `05-security-audit-and-money-separation.md` | Audit the contract; fix griefing, add revenue, split the pots | `b68b540` |
| `06-x402-gated-route.md` | Put the contract behind an x402-gated HTTP route | `c047b63` |
| `07-scheduler-fires-early-regression.md` | The security gate broke self-renewal; the tests missed it | `818c517` |
| `08-money-bugs-and-creditfor.md` | Four money bugs (one of them later reversed by step 11), and the payment→subscription join | `78025d2` |
| `09-forward-settlement-subscribefor.md` | The server opens the subscription with the settled payment | `c0d7e08` |
| `10-strip-the-template-product.md` | Remove the template's marketplace, ship Retainer's surface | `c939840` |
| `11-units-measured-not-assumed.md` | Measure Hedera's value units on testnet; reverse step 08's conversion | `9eb39e3` |
| `12-the-landing-page-as-an-instrument.md` | Design spec first, then rebuild the landing page around the moment the ring closes | the landing-page series after `9c7d416` |

## What is deliberately not in here

Routine iteration ("fix this test", "rename that variable") is not transcribed. That record
already exists, with better fidelity, in the commit history.

Raw assistant session transcripts are also not included. They contain event research and
competitive notes unrelated to directing this build, and dumping them would obscure the
picture this directory exists to give rather than clarify it.

The boundary is stated here explicitly so that what is included, and what is not, is visible.
