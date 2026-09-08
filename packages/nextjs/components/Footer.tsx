import React from "react";
import { SwitchTheme } from "~~/components/SwitchTheme";

/**
 * Site footer.
 *
 * The template floated an HBAR price pill and a faucet button over the bottom-left corner of
 * every page. Those are builder conveniences, and on a page whose job is to show one thing
 * happening on its own they sat on top of the proof links. Only the theme switch stays, out of
 * the way on the right.
 */
export const Footer = () => {
  return (
    <div className="min-h-0 py-5 px-1 mb-11 lg:mb-0">
      <div>
        <div className="fixed flex justify-end items-center w-full z-10 p-4 bottom-0 left-0 pointer-events-none">
          <SwitchTheme className="pointer-events-auto" />
        </div>
      </div>
      <div className="w-full">
        <ul className="menu menu-horizontal w-full">
          <div className="flex justify-center items-center gap-3 text-sm w-full text-base-content/60">
            <a
              href="https://github.com/edycutjong/retainer"
              target="_blank"
              rel="noreferrer"
              className="link hover:text-primary"
            >
              GitHub
            </a>
            <span className="opacity-30">|</span>
            <span>
              Built on{" "}
              <a
                href="https://hedera.com/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold link hover:text-primary"
              >
                Hedera
              </a>
            </span>
            <span className="opacity-30">|</span>
            <a
              href="https://hashscan.io/testnet/contract/0.0.10415845"
              target="_blank"
              rel="noreferrer"
              className="link hover:text-primary"
            >
              Contract on HashScan
            </a>
          </div>
        </ul>
      </div>
    </div>
  );
};
