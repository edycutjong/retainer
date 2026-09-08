"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { Instrument } from "~~/components/landing/Instrument";
import {
  CURRENT_CHAIN_TX,
  CURRENT_CONTRACT,
  CURRENT_REVERT,
  CURRENT_RUN,
  HASHSCAN,
  RECORDED_CONTRACT,
  RECORDED_RUN,
  UNATTENDED_RENEWALS,
} from "~~/components/landing/recordedRun";
import { DEMO_AGENT, ZERO, hbar, useLiveWindow } from "~~/components/landing/useLiveWindow";
import { useReveal } from "~~/components/landing/useReveal";
import { APP_VERSION } from "~~/utils/version";

/**
 * The landing page, which is also the live view.
 *
 * Retainer's claim is about something that happens when nobody is watching, which is a hard
 * thing to put on a screen. So the page is one instrument — the access window as a ring — and a
 * paper trail under it. The ring can replay the run the network actually executed on testnet
 * (four real transactions, each linking to HashScan) or watch any agent live; either way the
 * moment it reaches zero and closes again with nothing paid and nothing signed is the entire
 * product, and it is in the first viewport.
 *
 * Every number below is a chain read via /api/retainer/status or a receipt from docs/proof.md.
 * Nothing is simulated, estimated or rounded differently from the docs.
 */

const REPO = "https://github.com/edycutjong/retainer";

const Home: NextPage = () => {
  const live = useLiveWindow();
  useReveal([live.valid, live.status !== null]);
  const checkedDemo = useRef(false);

  // One read on arrival: if the demo agent's window is open on chain right now, the real thing
  // beats a replay, so the instrument starts live. If it is closed, the recorded run stays.
  useEffect(() => {
    if (checkedDemo.current || live.agent) return;
    checkedDemo.current = true;
    const ctrl = new AbortController();
    fetch(`/api/retainer/status?agent=${DEMO_AGENT}`, { cache: "no-store", signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (body?.hasAccess && !live.agent) live.setAgent(DEMO_AGENT);
      })
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watchDemo = () => {
    live.setAgent(DEMO_AGENT);
    if (window.innerWidth < 1024) {
      document.getElementById("instrument")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="rt-page">
      {/* ── Hero: the claim and the instrument, in one viewport */}
      <section className="rt-container pt-10 pb-12 sm:pt-14 lg:pt-16 lg:pb-16" aria-labelledby="claim">
        <div className="grid gap-5 lg:grid-cols-12 lg:gap-10 xl:gap-12 lg:items-center">
          {/* `contents` below lg so the instrument can sit between the claim and the CTAs on a phone */}
          <div className="contents lg:flex lg:flex-col lg:gap-6 lg:col-span-6 xl:col-span-5 min-w-0">
            <div className="rt-pills rt-enter">
              <span className="rt-pill rt-pill--armed">x402 · exact</span>
              <span className="rt-pill">Hedera testnet</span>
              <span className="rt-pill">HIP-1215 · 0x16b</span>
            </div>
            <h1 id="claim" className="rt-h1 rt-enter rt-enter--1">
              Your agent&rsquo;s access <span className="rt-renewed-text">renews itself</span>{" "}
              <span className="whitespace-nowrap">on-chain</span> at 3am, with nobody awake.
            </h1>
            <p className="rt-prose rt-enter rt-enter--2 order-4 lg:order-none mt-2 lg:mt-0 text-[1.0625rem] sm:text-lg leading-relaxed">
              An x402-gated feed on Hedera. One payment, signed once; the Hedera Schedule Service renews the window.
            </p>
            <div className="flex flex-wrap gap-3 rt-enter rt-enter--3 order-5 lg:order-none">
              <button type="button" className="rt-btn rt-btn--primary" onClick={watchDemo}>
                Watch the demo agent
              </button>
              <Link href="/judge" className="rt-btn rt-btn--ghost">
                For judges · 30 s <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
          <div className="order-3 lg:order-none mt-1 lg:mt-0 lg:col-span-6 xl:col-span-7 min-w-0 rt-enter rt-enter--2">
            <Instrument live={live} />
          </div>
        </div>
      </section>

      {/* ── Receipt band */}
      <section className="rt-container pb-4" aria-label="Measured results">
        <div className="rt-stats">
          <Stat
            value={<>{UNATTENDED_RENEWALS.total}</>}
            label="renewals the network executed by itself — three deployments, every one scheduled=true · SUCCESS"
            source={`mirror node · ${UNATTENDED_RENEWALS.byContract.join(" + ")} · 2026-09-08`}
          />
          <Stat
            value={<>~30×</>}
            label="1.54896 ℏ to renew and re-arm, 0.0507 ℏ to renew without — re-arming is ~97% of the cost"
            source="docs/proof.md · first run; current deployment repeats it at 1.5404 / 0.0522 ℏ"
          />
          <Stat
            value={<span className="rt-renewed-text rt-stat__v--code">scheduled=true</span>}
            label="the ledger's mark for a call nobody submitted"
            source="mirror node · CONTRACTCALL · SUCCESS"
          />
          <Stat
            value={<>46 + 10</>}
            label="contract tests + resource-server tests passing"
            source="yarn hardhat:test · yarn next:test"
          />
        </div>
      </section>

      {/* ── How it works */}
      <section id="how" className="rt-section" aria-labelledby="how-title">
        <div className="rt-container">
          <div className="max-w-2xl rt-reveal">
            <p className="rt-eyebrow">How it works</p>
            <h2 id="how-title" className="rt-h2 mt-3">
              402 → pay → 200 → <span className="rt-renewed-text">still 200</span>.
            </h2>
            <p className="rt-prose mt-4">
              The ordinary x402 pattern charges on every request: 402, sign, retry, pay, repeat forever. That works for
              one-off calls and breaks for anything an agent needs continuously — somebody has to keep paying, so
              somebody has to stay awake. Here the gate is an on-chain subscription that the network renews.
            </p>
          </div>
          <ol className="rt-rail mt-10 list-none m-0 p-0">
            <Step n="01" http="GET /api/retainer/access → 402" title="A cold agent is charged">
              The route reads <code className="rt-code">hasAccess(agent)</code> on-chain, gets{" "}
              <code className="rt-code">false</code>, and answers with an x402 challenge:{" "}
              <code className="rt-code">scheme: exact</code>, <code className="rt-code">network: hedera:testnet</code>,
              native HBAR.
            </Step>
            <Step n="02" http="PAYMENT-SIGNATURE → settled by Blocky402" title="It signs one payment">
              Verified and settled through the hosted Blocky402 facilitator. This is the only thing the agent ever
              signs.
            </Step>
            <Step n="03" http="subscribeFor(agent) · scheduleCall(0x16b)" title="The payment becomes on-chain state">
              The server forwards what it received into <code className="rt-code">RetainerAccess</code>, which charges
              period one and arms the first renewal with the Hedera Schedule Service.
            </Step>
            <Step n="04" http="GET … → 200 · paidThisRequest:false" title="Still 200 after the window expired" claim>
              Between the two requests the network executed <code className="rt-code">renew()</code> itself —{" "}
              <code className="rt-code">CONTRACTCALL</code>, <code className="rt-code">scheduled=true</code>. Nothing
              was paid, nobody was awake, no cron ran.
            </Step>
          </ol>
        </div>
      </section>

      {/* ── The window, live */}
      <section id="live" className="rt-section" aria-labelledby="live-title">
        <div className="rt-container">
          <div className="flex flex-wrap items-end justify-between gap-4 rt-reveal">
            <div className="max-w-2xl">
              <p className="rt-eyebrow">The window, live</p>
              <h2 id="live-title" className="rt-h2 mt-3">
                Every number here is a chain read.
              </h2>
              <p className="rt-prose mt-4">
                <code className="rt-code">/api/retainer/status</code> asks the contract and nothing else, so this can be
                polled without ever touching the payment path. Paste an address in the instrument above, or watch the
                demo agent.
              </p>
            </div>
            {!live.valid && (
              <button type="button" className="rt-btn rt-btn--ghost" onClick={() => live.setAgent(DEMO_AGENT)}>
                Watch the demo agent
              </button>
            )}
          </div>

          {live.error && (
            <p role="alert" className="mt-8 rt-panel rt-small" style={{ borderColor: "var(--rt-error)" }}>
              {live.error}
            </p>
          )}

          {live.status ? (
            <LivePanels live={live} />
          ) : (
            <p className="rt-small mt-8" style={{ color: "var(--rt-text-low)" }}>
              {live.loading
                ? "Reading the chain…"
                : "No agent selected. The meter, the balance, the pending schedule and the event log appear here as chain state."}
            </p>
          )}
        </div>
      </section>

      {/* ── Proof */}
      <section id="proof" className="rt-section" aria-labelledby="proof-title">
        <div className="rt-container">
          <div className="max-w-2xl rt-reveal">
            <p className="rt-eyebrow">Proof</p>
            <h2 id="proof-title" className="rt-h2 mt-3">
              Check it on Hedera yourself, not on our word.
            </h2>
            <p className="rt-prose mt-4">
              <code className="rt-code">scheduled=true</code> on a <code className="rt-code">SUCCESS</code>{" "}
              <code className="rt-code">CONTRACTCALL</code> is the ledger saying the transaction had no submitter. The
              run below is the one the instrument replays: the contract paid for its own executions, re-armed itself
              twice, and stopped loudly when the money ran out.
            </p>
          </div>

          <div className="rt-plate mt-10 p-4 sm:p-6 rt-reveal">
            <div className="rt-ledger-wrap">
              <table className="rt-ledger">
                <caption>
                  The recorded run on <span className="rt-mono">{RECORDED_CONTRACT.id}</span> — read back from the
                  public mirror node, {RECORDED_CONTRACT.date}. Timestamps open HashScan.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Consensus</th>
                    <th scope="col">UTC</th>
                    <th scope="col">Type</th>
                    <th scope="col">scheduled</th>
                    <th scope="col">Charged</th>
                    <th scope="col">What the contract said</th>
                  </tr>
                </thead>
                <tbody>
                  {RECORDED_RUN.map(r => (
                    <tr
                      key={r.consensus}
                      className={r.kind === "renewed" ? "is-renewed" : r.kind === "lapsed" ? "is-lapsed" : ""}
                    >
                      <td>
                        <a className="rt-link rt-mono" href={r.href} target="_blank" rel="noreferrer">
                          {r.consensus}
                        </a>
                      </td>
                      <td className="rt-mono">{r.utc}</td>
                      <td className="rt-mono">{r.type}</td>
                      <td>
                        <span className={`rt-tag${r.scheduled ? " rt-tag--renewed" : ""}`}>
                          {r.scheduled ? "true" : "false"}
                        </span>
                      </td>
                      <td className="rt-mono">{r.feeLabel}</td>
                      <td>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rt-ledger-wrap mt-6">
              <table className="rt-ledger">
                <caption>
                  The current deployment, <span className="rt-mono">{CURRENT_CONTRACT.id}</span> — the same loop on the
                  deployed source, {CURRENT_CONTRACT.periodSeconds}s periods, read back 2026-09-08. One scheduled
                  execution reverted; the run that followed is eight renewals by the network, the last one lapsing.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Consensus</th>
                    <th scope="col">UTC</th>
                    <th scope="col">Type</th>
                    <th scope="col">scheduled</th>
                    <th scope="col">Charged</th>
                    <th scope="col">What the contract said</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="is-renewed">
                    <td>
                      <a
                        className="rt-link rt-mono"
                        href={`${HASHSCAN}/transaction/1788840325.135282208`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        1788840325.135282208
                      </a>
                    </td>
                    <td className="rt-mono">04:05:25</td>
                    <td className="rt-mono">CONTRACTCALL</td>
                    <td>
                      <span className="rt-tag rt-tag--renewed">true</span>
                    </td>
                    <td className="rt-mono">1.54327368 ℏ</td>
                    <td>Renewed · after a 3 ℏ x402 payment opened the window · re-armed 0.0.10416101</td>
                  </tr>
                  <tr className="is-reverted">
                    <td>
                      <a className="rt-link rt-mono" href={CURRENT_REVERT.href} target="_blank" rel="noreferrer">
                        {CURRENT_REVERT.consensus}
                      </a>
                    </td>
                    <td className="rt-mono">04:06:55</td>
                    <td className="rt-mono">CONTRACTCALL</td>
                    <td>
                      <span className="rt-tag rt-tag--renewed">true</span>
                    </td>
                    <td className="rt-mono">{CURRENT_REVERT.feeLabel}</td>
                    <td>
                      <span className="rt-tag rt-tag--lapsed">CONTRACT_REVERT_EXECUTED</span> {CURRENT_REVERT.error} —
                      the contract&rsquo;s own solvency guard rejected the network&rsquo;s call. Limitation 03.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <a
                        className="rt-link rt-mono"
                        href={`${HASHSCAN}/transaction/1788844245.406393732`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        1788844245.406393732
                      </a>
                    </td>
                    <td className="rt-mono">05:10:45</td>
                    <td className="rt-mono">ETHEREUMTRANSACTION</td>
                    <td>
                      <span className="rt-tag">false</span>
                    </td>
                    <td className="rt-mono">1,481,020 gas</td>
                    <td>
                      renew() sent by the seller after creditFor(+8 ℏ) — the restart · RenewalScheduled 0.0.10416711
                    </td>
                  </tr>
                  {CURRENT_RUN.map(r => (
                    <tr key={r.consensus} className={r.kind === "renewed" ? "is-renewed" : "is-lapsed"}>
                      <td>
                        <a className="rt-link rt-mono" href={r.href} target="_blank" rel="noreferrer">
                          {r.consensus}
                        </a>
                      </td>
                      <td className="rt-mono">{r.utc}</td>
                      <td className="rt-mono">CONTRACTCALL</td>
                      <td>
                        <span className="rt-tag rt-tag--renewed">true</span>
                      </td>
                      <td className="rt-mono">{r.feeLabel}</td>
                      <td>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7 min-w-0 flex flex-col gap-5">
                <CopyPre
                  title="The recorded run, whole chain, one request"
                  text={`curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7314364-1788780163-271854529" \\
  | jq -r '.transactions[] | [.consensus_timestamp, .name, "scheduled=\\(.scheduled)", .result, "fee=\\(.charged_tx_fee)"] | @tsv'`}
                />
                <CopyPre
                  title="The current deployment's eight renewals, one request"
                  text={`curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/${CURRENT_CHAIN_TX}" \\
  | jq -r '.transactions[] | [.consensus_timestamp, .name, "scheduled=\\(.scheduled)", .result, "fee=\\(.charged_tx_fee)"] | @tsv'`}
                />
              </div>
              <div className="lg:col-span-5 min-w-0 rt-small" style={{ color: "var(--rt-text-mid)" }}>
                <p>
                  The scheduled calls inherit the transaction id of the EVM call that armed the first schedule, so one
                  response holds that call, every renewal it led to and every{" "}
                  <code className="rt-code">SCHEDULECREATE</code> between them.
                </p>
                <p className="mt-3">
                  Three deployments exist — the recorded run&rsquo;s <span className="rt-mono">0.0.10406083</span>, an
                  intermediate <span className="rt-mono">0.0.10414167</span>, and the current one — and they are not the
                  same code.{" "}
                  <a className="rt-link" href={`${REPO}/blob/main/docs/proof.md`} target="_blank" rel="noreferrer">
                    docs/proof.md
                  </a>{" "}
                  keeps them apart and says exactly where they differ.
                </p>
                <p className="mt-3">
                  Contract on HashScan:{" "}
                  <a
                    className="rt-link rt-mono"
                    href={`${HASHSCAN}/contract/${CURRENT_CONTRACT.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {CURRENT_CONTRACT.id}
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Questions */}
      <section id="questions" className="rt-section" aria-labelledby="q-title">
        <div className="rt-container grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4 rt-reveal">
            <p className="rt-eyebrow">Questions a judge asks</p>
            <h2 id="q-title" className="rt-h2 mt-3">
              Answered from the docs, not from the pitch.
            </h2>
          </div>
          <div className="lg:col-span-8 rt-faq rt-reveal">
            <details>
              <summary>Is anything on this page simulated?</summary>
              <div>
                No. Live mode is <code className="rt-code">/api/retainer/status</code>, a chain read. The recorded run
                is four transactions from the public mirror node; each row and each chip links to HashScan. There is no
                offline, mock or demo mode for the product.
              </div>
            </details>
            <details>
              <summary>What does the agent sign?</summary>
              <div>
                One x402 payment — a Hedera <code className="rt-code">TransferTransaction</code> under the{" "}
                <code className="rt-code">exact</code> scheme, settled by the Blocky402 facilitator. Renewals are{" "}
                <code className="rt-code">CONTRACTCALL</code>s the network executes from a schedule;{" "}
                <code className="rt-code">scheduled=true</code> is the ledger saying there was no submitter.
              </div>
            </details>
            <details>
              <summary>Who pays for a renewal?</summary>
              <div>
                The contract, from its own <code className="rt-code">gasReserve</code>. One re-arming renewal cost
                1.54896 ℏ on testnet; at 1 ℏ per period the seller loses money on every renewal. That is stated in the
                README and on{" "}
                <Link className="rt-link" href="/judge">
                  /judge
                </Link>
                , not hidden.
              </div>
            </details>
            <details>
              <summary>What happens when the money runs out?</summary>
              <div>
                The renewal charges the last period, emits{" "}
                <code className="rt-code">Lapsed(&quot;balance will not cover the next period&quot;)</code> and does not
                re-arm. The last row of each ledger above is that event — 0.0507 ℏ on the recorded run, 0.0522 ℏ on the
                current deployment — with no <code className="rt-code">SCHEDULECREATE</code> after it. Loud, not silent.
              </div>
            </details>
            <details>
              <summary>Which Hedera Schedule Service calls are load-bearing?</summary>
              <div>
                Three: <code className="rt-code">scheduleCall</code> arms the renewal,{" "}
                <code className="rt-code">hasScheduleCapacity</code> is asked before arming so a full second becomes a
                clean <code className="rt-code">Lapsed</code> rather than a silent stop, and{" "}
                <code className="rt-code">deleteSchedule</code> returns the held gas on{" "}
                <code className="rt-code">cancel()</code>. Remove any one and the product breaks rather than degrades.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* ── Limitations */}
      <section id="limits" className="rt-section" aria-labelledby="limits-title">
        <div className="rt-container grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4 rt-reveal">
            <p className="rt-eyebrow">What this does not claim</p>
            <h2 id="limits-title" className="rt-h2 mt-3">
              Three real limitations. None is fixed here.
            </h2>
          </div>
          <ol className="lg:col-span-8 grid gap-4 sm:grid-cols-3 list-none m-0 p-0 rt-reveal">
            <li className="rt-panel">
              <p className="rt-mono-ui rt-eyebrow--expiring" style={{ color: "var(--rt-expiring-ink)" }}>
                01
              </p>
              <h3 className="rt-h3 mt-2">It loses money at the default price.</h3>
              <p className="rt-small mt-2" style={{ color: "var(--rt-text-mid)" }}>
                A renewal burns ~1.55 ℏ of the seller&rsquo;s gas reserve to collect 1 ℏ. Pricing a period above the
                renewal cost is a product decision this build did not make.
              </p>
            </li>
            <li className="rt-panel">
              <p className="rt-mono-ui" style={{ color: "var(--rt-expiring-ink)" }}>
                02
              </p>
              <h3 className="rt-h3 mt-2">The metering write is fire-and-forget.</h3>
              <p className="rt-small mt-2" style={{ color: "var(--rt-text-mid)" }}>
                The allowance is enforced by simulating <code className="rt-code">meter()</code>, but the recording
                transaction is not awaited. A burst can overshoot by roughly the number in flight.
              </p>
            </li>
            <li className="rt-panel">
              <p className="rt-mono-ui" style={{ color: "var(--rt-expiring-ink)" }}>
                03
              </p>
              <h3 className="rt-h3 mt-2">One scheduled renewal reverted on the deployed source.</h3>
              <p className="rt-small mt-2" style={{ color: "var(--rt-text-mid)" }}>
                At{" "}
                <a className="rt-link rt-mono" href={CURRENT_REVERT.href} target="_blank" rel="noreferrer">
                  04:06:55
                </a>{" "}
                the network fired <code className="rt-code">renew()</code> and the contract&rsquo;s own{" "}
                <code className="rt-code">Insolvent()</code> guard rejected it; the run had to be restarted by hand. The
                numbers point at the gas Hedera reserves on the payer during a scheduled call. Not fixed here.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* ── Final CTA */}
      <section className="rt-plate rt-plate--band py-16 sm:py-20" aria-labelledby="cta-title">
        <div className="rt-container text-center flex flex-col items-center gap-5 rt-reveal">
          <p className="rt-eyebrow rt-eyebrow--renewed">For whoever is judging this</p>
          <h2 id="cta-title" className="rt-h2 max-w-2xl">
            The 30-second read: the claim, four commands, the measured costs, and the limitations.
          </h2>
          <p className="rt-prose mx-auto">
            No account, no key, no clone. Everything runs against the live deployment and the real Hedera testnet.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            <Link href="/judge" className="rt-btn rt-btn--primary">
              Open /judge
            </Link>
            <a href={REPO} target="_blank" rel="noreferrer" className="rt-btn rt-btn--ghost">
              Read the repository
            </a>
          </div>
          <p className="rt-mono-ui mt-2" style={{ color: "var(--rt-text-low)" }}>
            contract {CURRENT_CONTRACT.id} · retainer.edycu.dev · {APP_VERSION}
          </p>
        </div>
      </section>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────── */

const Stat = ({ value, label, source }: { value: React.ReactNode; label: string; source: string }) => (
  <div className="rt-stat rt-reveal">
    <span className="rt-stat__v">{value}</span>
    <span className="rt-stat__l">{label}</span>
    <span className="rt-stat__s">{source}</span>
  </div>
);

const Step = ({
  n,
  http,
  title,
  claim,
  children,
}: {
  n: string;
  http: string;
  title: string;
  claim?: boolean;
  children: React.ReactNode;
}) => (
  <li className={`rt-step rt-reveal${claim ? " rt-step--claim" : ""}`}>
    <span className={`rt-eyebrow${claim ? " rt-eyebrow--renewed" : ""}`}>{n}</span>
    <code className="rt-step__http">{http}</code>
    <h3 className="rt-h3">{title}</h3>
    <p>{children}</p>
  </li>
);

const LivePanels = ({ live }: { live: ReturnType<typeof useLiveWindow> }) => {
  const s = live.status!;
  const armed = s.nextRenewalSchedule !== ZERO;
  return (
    <div className="rt-live mt-8 rt-reveal">
      <div className="flex flex-col gap-5">
        <div className="rt-panel">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h3 className="rt-h3">Calls this period</h3>
            <span className="rt-mono-ui" style={{ color: "var(--rt-text-mid)" }}>
              {s.usage ? `${s.usage.remaining} of ${s.usage.allowance} left` : "unread this poll"}
            </span>
          </div>
          {s.usage ? (
            <div
              className="rt-meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={s.usage.allowance}
              aria-valuenow={s.usage.remaining}
              aria-valuetext={`${s.usage.remaining} of ${s.usage.allowance} calls left this period`}
              aria-label="Metered calls remaining this period"
            >
              {Array.from({ length: s.usage.allowance }, (_, i) => (
                <span key={i} className={`rt-meter__seg${i < s.usage!.remaining ? " is-left" : ""}`} />
              ))}
            </div>
          ) : (
            <p className="rt-small mt-3" style={{ color: "var(--rt-text-low)" }}>
              The relay did not answer <code className="rt-code">usageOf()</code> on this poll. The window above is
              unaffected; the meter shows again on the next read rather than a guessed value.
            </p>
          )}
          <p className="rt-small mt-3" style={{ color: "var(--rt-text-mid)" }}>
            The period buys a countable quantity, not an unlimited licence — every served call is counted on-chain. The
            renewal that extends the window also refills this.
          </p>
        </div>

        <div className="rt-panel">
          <h3 className="rt-h3 mb-4">The subscription, in numbers</h3>
          <dl className="rt-numbers">
            <div>
              <dt>balance</dt>
              <dd>{hbar(s.balanceTinybar)} ℏ</dd>
            </div>
            <div>
              <dt>periods funded</dt>
              <dd>{s.periodsFunded}</dd>
            </div>
            <div>
              <dt>price / period</dt>
              <dd>{hbar(s.pricePerPeriodTinybar)} ℏ</dd>
            </div>
            <div>
              <dt>reserve can arm</dt>
              <dd>
                {s.renewalsReserveCanArm === null ? (
                  <span className="rt-tag" title="renewalsRemaining() was not answered on this poll">
                    unknown
                  </span>
                ) : (
                  s.renewalsReserveCanArm
                )}
              </dd>
            </div>
            <div>
              <dt>period</dt>
              <dd>{s.periodSeconds}s</dd>
            </div>
            <div>
              <dt>state</dt>
              <dd>
                <span className={`rt-tag${s.hasAccess ? " rt-tag--renewed" : ""}`}>
                  {s.hasAccess ? "access open" : "access closed"}
                </span>{" "}
                {armed && <span className="rt-tag">renewal armed</span>}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="rt-panel">
          <h3 className="rt-h3 mb-2">On-chain</h3>
          <ProofRow label="contract" href={`${HASHSCAN}/contract/${s.contract}`} value={s.contract} />
          {armed && (
            <ProofRow
              label="pending schedule"
              href={`${HASHSCAN}/account/${s.nextRenewalSchedule}`}
              value={s.nextRenewalSchedule}
            />
          )}
          <ProofRow label="agent" href={`${HASHSCAN}/account/${s.agent}`} value={s.agent} />
        </div>

        <div className="rt-panel">
          <h3 className="rt-h3 mb-3">Seen while this page was open</h3>
          {live.log.length === 0 ? (
            <p className="rt-small" style={{ color: "var(--rt-text-low)" }}>
              Nothing yet. Renewals and metered calls appear here as they happen on chain.
            </p>
          ) : (
            <ul className="rt-log">
              {live.log.map(e => (
                <li key={e.id} className={e.kind === "renewed" ? "is-renewed" : ""}>
                  <time dateTime={new Date(e.at * 1000).toISOString()}>
                    {new Date(e.at * 1000).toLocaleTimeString()}
                  </time>
                  <span className="rt-small">{e.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

const ProofRow = ({ label, href, value }: { label: string; href: string; value: string }) => (
  <div className="rt-proofrow">
    <span>{label}</span>
    <a className="rt-link rt-mono" href={href} target="_blank" rel="noreferrer">
      {value}
    </a>
  </div>
);

const CopyPre = ({ text, title }: { text: string; title: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the text is selectable */
    }
  };
  return (
    <div className="min-w-0">
      <div className="rt-pre__head">
        <p className="rt-eyebrow">{title}</p>
        <button type="button" className="rt-btn rt-btn--ghost rt-btn--sm" onClick={copy} aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="rt-pre" tabIndex={0}>
        <code>{text}</code>
      </pre>
    </div>
  );
};

export default Home;
