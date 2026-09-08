# 07 — Run the whole flow against the network, and find out the security fix broke the feature

**Commit produced:** `818c517` — *Fix self-renewal regression: the scheduler fires early*
**When:** 2026-09-07 18:25 +07

## The direction given

Stop testing pieces. Run the entire claim end to end against Hedera testnet, as an agent would,
and then **wait, sending nothing**, and see whether access survives the expiry.

An agent script — not a browser — does the run: hit the route with no access, pay the 402
through Blocky402, subscribe, confirm `200 paidThisRequest:false`, then idle past the window
and hit it again. If the second request after expiry is not a 200, the project does not work,
regardless of what the unit tests say.

## Why it was given then

Every component had passed its own test. That is the exact condition under which an integration
is most likely to be broken, and unit tests written by the same process that wrote the code are
the least likely thing to notice.

## What the run found

Self-renewal had stopped working, and **every unit test still passed.**

The step-05 griefing fix gated `renew()` on `block.timestamp >= expiresAt`. Correct-looking, and
wrong: on testnet the block timestamp the scheduled call saw was **behind** the second it was
scheduled for. Against contract `0.0.10406002` the schedule was armed for
`expiresAt = 1788779924`, the network executed it at consensus `1788779924.038958161`, and the
call reverted anyway — `CONTRACT_REVERT_EXECUTED`, no `Renewed` event, no re-arm. The network's
own scheduled call was being rejected by the defence built to stop attackers.

The tests missed it because they advanced `PERIOD + 1` seconds and never landed on the boundary
the real scheduler lands on. A test that only ever tests the comfortable side of a comparison is
not testing the comparison.

## The fix, and why it is not a hole

`RENEW_SLACK = 30` seconds. Wide enough for consensus timing, worthless to an attacker:
renewing early still charges a full period, so there is nothing to gain by calling it early.
Two regression tests added — a renewal five seconds early must succeed, a far-early one must
still revert.

(This constant is what makes `MIN_PERIOD_SECONDS` necessary in step 08: a period shorter than
twice the slack would leave the callable window permanently open.)

## Verified end to end against the network — contract `0.0.10406083`

```
402 -> paid via Blocky402 (0.0.7162784@1788780154.225876092) -> subscribed
    -> 200 paidThisRequest=false -> waited 105s sending nothing -> 200 again
```

The transfers confirm the model is non-custodial: agent −1 HBAR, seller +1 HBAR, and Blocky402
pays only the 0.0025 HBAR network fee. Two scheduled `CONTRACTCALL`s succeeded unattended, each
arming the next — so the loop is self-sustaining rather than one-shot.

## What the same run measured about cost

Three scheduled executions ran in total, and the third is the interesting one:

| consensus time | charged | outcome |
|---|---|---|
| `1788780226.016366208` | 154,896,000 tinybar (1.54896 HBAR) | renewed **and** re-armed the next |
| `1788780286.019735208` | 154,896,000 tinybar (1.54896 HBAR) | renewed **and** re-armed the next |
| `1788780346.345418842` | 5,067,825 tinybar (0.0507 HBAR) | charged the last period, then lapsed: emitted `Lapsed`, did **not** re-arm |

The 30× gap is the whole cost story: re-arming the next renewal — the `scheduleCall` into
`0x16b` — is roughly 97% of what a renewal costs. The renewal's own bookkeeping is the cheap
0.05 HBAR part. The `Lapsed` path from step 05 is visible working in row three.
