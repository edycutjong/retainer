"use client";

import { useRef } from "react";
import { useHederaWalletConnect } from "~~/services/web3/hederaWalletConnect";
import { getParsedError, notification } from "~~/utils/scaffold-hbar";

/**
 * HashPack connect via Reown AppKit (native Hedera namespace only).
 *
 * This button does not import AppKit. It asks the context to connect, and the context loads the
 * wallet SDK at that moment — so a visitor who never reaches for a wallet never pays for one.
 * Hover and keyboard focus start the download early, so the click still feels immediate.
 */
export const WalletConnectButton = () => {
  const { accountId, isConnected, isBusy, isInitializing, connectWallet, disconnectWallet, prefetchWallet } =
    useHederaWalletConnect();
  const menuRef = useRef<HTMLDetailsElement>(null);

  if (!isConnected) {
    return (
      <button
        className="btn btn-primary btn-sm"
        onPointerEnter={prefetchWallet}
        onFocus={prefetchWallet}
        onClick={() => {
          void connectWallet().catch(e => {
            notification.error(getParsedError(e));
          });
        }}
        disabled={isBusy}
        type="button"
      >
        {isInitializing ? "Connecting..." : "Connect HashPack"}
      </button>
    );
  }

  const shortAccount = accountId ? `${accountId.slice(0, 6)}...${accountId.slice(-4)}` : "Connected";

  return (
    <div className="dropdown dropdown-end">
      <details ref={menuRef}>
        <summary className="btn btn-secondary btn-sm list-none" title={accountId ?? "Connected"}>
          <span className="hidden sm:inline">HashPack</span>
          <span>{shortAccount}</span>
        </summary>
        <ul className="menu dropdown-content mt-2 z-[60] w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
          <li className="menu-title">
            <span>{accountId}</span>
          </li>
          <li>
            <button
              type="button"
              className="justify-start normal-case"
              onClick={() => {
                if (!accountId || !navigator?.clipboard?.writeText) return;
                void navigator.clipboard.writeText(accountId);
                menuRef.current?.removeAttribute("open");
              }}
            >
              Copy account ID
            </button>
          </li>
          <li>
            <button
              type="button"
              className="text-error justify-start normal-case"
              onClick={() => {
                menuRef.current?.removeAttribute("open");
                void disconnectWallet();
              }}
              disabled={isBusy}
            >
              {isBusy ? "Disconnecting..." : "Disconnect"}
            </button>
          </li>
        </ul>
      </details>
    </div>
  );
};
