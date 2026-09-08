"use client";

import type { ComponentType } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { AppKitApi, AppKitBridgeProps, AppKitSnapshot } from "./appKitBridge";
import type { HederaProvider } from "@hashgraph/hedera-wallet-connect";

/**
 * The wallet context. It deliberately imports NOTHING from Reown AppKit or the Hedera SDK — only
 * types, which erase at build time. All of that lives in `appKitBridge`, loaded on demand.
 *
 * Two rules this file exists to keep:
 *   - `children` are never gated on wallet init. Gating them meant the server rendered a spinner
 *     instead of the app, so the prerendered HTML had no <main>, no <header> and no <h1>, and the
 *     LCP element did not exist until hydration had finished (measured: LCP 11.2 s on mobile).
 *   - The wallet SDK is fetched at the first sign a visitor wants a wallet, not on every page load.
 */

type HederaWalletConnectContextValue = {
  provider: HederaProvider | null;
  /** Native Hedera account id from the WalletConnect session. */
  hederaAccountId: string | null;
  /** Alias of `hederaAccountId` for display components. */
  accountId: string | null;
  hasHederaSession: boolean;
  isConnected: boolean;
  isInitializing: boolean;
  isBusy: boolean;
  /** Loads AppKit if needed, then opens the Connect view. Safe to call before anything is loaded. */
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  /** Starts fetching the wallet SDK without opening anything — for hover/focus intent. */
  prefetchWallet: () => void;
};

const EMPTY_SNAPSHOT: AppKitSnapshot = {
  provider: null,
  accountId: null,
  hasHederaSession: false,
  isConnected: false,
};

const HederaWalletConnectContext = createContext<HederaWalletConnectContextValue | undefined>(undefined);

export const HederaWalletConnectProvider = ({ children }: { children: React.ReactNode }) => {
  /**
   * The bridge component, once fetched. `next/dynamic` was not enough here: with the import at
   * module scope Next still emitted `<script src=".../5395.js" async>` into the HTML, so the 375 KiB
   * arrived on every page load even though nothing rendered it. Importing imperatively, only when a
   * visitor reaches for a wallet, is what actually keeps it off the first load.
   */
  const [Bridge, setBridge] = useState<ComponentType<AppKitBridgeProps> | null>(null);
  const loading = useRef(false);
  const [snapshot, setSnapshot] = useState<AppKitSnapshot>(EMPTY_SNAPSHOT);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const apiRef = useRef<AppKitApi | null>(null);
  /** Set when connect was clicked before AppKit finished loading; drained once the API arrives. */
  const openWhenReady = useRef(false);

  const onApi = useCallback((api: AppKitApi) => {
    apiRef.current = api;
    if (openWhenReady.current) {
      openWhenReady.current = false;
      void api.openConnect().catch(err => console.error("HashPack connect failed", err));
    }
  }, []);

  const onSnapshot = useCallback((next: AppKitSnapshot) => setSnapshot(next), []);

  const onSettled = useCallback(() => setIsInitializing(false), []);

  const prefetchWallet = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    setIsInitializing(true);
    void import("./appKitBridge")
      .then(mod => setBridge(() => mod.default))
      .catch(err => {
        console.error("Wallet SDK failed to load", err);
        loading.current = false;
        setIsInitializing(false);
      });
  }, []);

  const connectWallet = useCallback(async () => {
    if (apiRef.current) {
      await apiRef.current.openConnect();
      return;
    }
    openWhenReady.current = true;
    prefetchWallet();
  }, [prefetchWallet]);

  const disconnectWallet = useCallback(async () => {
    if (isBusy || !apiRef.current) return;
    setIsBusy(true);
    try {
      await apiRef.current.disconnect();
    } catch (error) {
      console.error("HashPack disconnect failed", error);
    } finally {
      setIsBusy(false);
    }
  }, [isBusy]);

  const value = useMemo<HederaWalletConnectContextValue>(
    () => ({
      provider: snapshot.provider,
      hederaAccountId: snapshot.accountId,
      accountId: snapshot.accountId,
      hasHederaSession: snapshot.hasHederaSession,
      isConnected: snapshot.isConnected,
      isInitializing,
      isBusy,
      connectWallet,
      disconnectWallet,
      prefetchWallet,
    }),
    [snapshot, isInitializing, isBusy, connectWallet, disconnectWallet, prefetchWallet],
  );

  return (
    <HederaWalletConnectContext.Provider value={value}>
      {Bridge ? <Bridge onApi={onApi} onSnapshot={onSnapshot} onSettled={onSettled} /> : null}
      {children}
    </HederaWalletConnectContext.Provider>
  );
};

export const useHederaWalletConnect = () => {
  const ctx = useContext(HederaWalletConnectContext);
  if (!ctx) throw new Error("useHederaWalletConnect must be used inside HederaWalletConnectProvider");
  return ctx;
};
