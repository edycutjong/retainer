import React from "react";
import Image from "next/image";
import Link from "next/link";
import { SwitchTheme } from "~~/components/SwitchTheme";

const REPO = "https://github.com/edycutjong/retainer";
const CONTRACT_ID = "0.0.10415845";
/** No git tag exists yet; `git describe --tags --abbrev=0` has nothing to say, so this says so. */
const VERSION = "v0.0.0-dev";

/**
 * Site footer.
 *
 * A real footer, not a floating price pill: what the product is, where to verify it, where the
 * evidence lives, and what it was built for. The theme switch lives in the bottom bar rather than
 * hovering over the proof links.
 */
export const Footer = () => {
  return (
    <footer className="rt-footer">
      <div className="rt-container">
        <div className="rt-footer__grid">
          <div>
            <Link href="/" className="rt-brand" aria-label="Retainer — home">
              <Image alt="" src="/icon.svg" width={28} height={28} className="rounded-[7px]" />
              <span className="rt-brand__name">Retainer</span>
            </Link>
            <p className="mt-3 max-w-xs">Your agent&rsquo;s access renews itself on-chain at 3am, with nobody awake.</p>
            <p className="mt-3 rt-mono-ui">
              <span className="rt-tag">{VERSION}</span>
            </p>
          </div>
          <nav aria-labelledby="f-product">
            <h2 id="f-product">Product</h2>
            <ul>
              <li>
                <Link href="/">Live view</Link>
              </li>
              <li>
                <Link href="/judge">For judges</Link>
              </li>
              <li>
                <a href={`https://hashscan.io/testnet/contract/${CONTRACT_ID}`} target="_blank" rel="noreferrer">
                  Contract on HashScan · <span className="rt-mono">{CONTRACT_ID}</span>
                </a>
              </li>
              <li>
                <Link href="/debug">Debug the contract</Link>
              </li>
            </ul>
          </nav>
          <nav aria-labelledby="f-evidence">
            <h2 id="f-evidence">Evidence</h2>
            <ul>
              <li>
                <a href={`${REPO}/blob/main/docs/proof.md`} target="_blank" rel="noreferrer">
                  On-chain proof, with re-verify commands
                </a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/gas-economics.md`} target="_blank" rel="noreferrer">
                  What an unattended renewal costs
                </a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/hedera-units.md`} target="_blank" rel="noreferrer">
                  The unit trap, measured
                </a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/AI-USAGE.md`} target="_blank" rel="noreferrer">
                  How AI was used, per file
                </a>
              </li>
              <li>
                <a href={`${REPO}/tree/main/prompts`} target="_blank" rel="noreferrer">
                  The prompts that directed the build
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-labelledby="f-built">
            <h2 id="f-built">Built</h2>
            <ul>
              <li>
                <a href="https://ethglobal.com/events/ethonline2026" target="_blank" rel="noreferrer">
                  ETHGlobal ETHOnline 2026
                </a>
              </li>
              <li>
                <a href="https://hedera.com/" target="_blank" rel="noreferrer">
                  Hedera — AI &amp; Agentic Payments
                </a>
              </li>
              <li>
                <a href={REPO} target="_blank" rel="noreferrer">
                  GitHub — edycutjong/retainer
                </a>
              </li>
              <li>
                <a href="https://retainer.edycu.dev" target="_blank" rel="noreferrer">
                  retainer.edycu.dev
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="rt-footer__bar">
          <p>
            MIT · built from{" "}
            <a href="https://github.com/hedera-dev/scaffold-hbar" target="_blank" rel="noreferrer">
              hedera-dev/scaffold-hbar
            </a>{" "}
            (<span className="rt-mono">templates/x402-pay-per-use</span>) · testnet only · not audited
          </p>
          <SwitchTheme />
        </div>
      </div>
    </footer>
  );
};
