"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { AppKitApi, AppKitSnapshot } from "./appKitBridge";
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

const AppKitBridge = dynamic(() => import("./appKitBridge"), { ssr: false });

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
  /** Mounting the bridge is what pulls the wallet SDK over the wire. */
  const [armed, setArmed] = useState(false);
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
    setArmed(armedAlready => {
      if (!armedAlready) setIsInitializing(true);
      return true;
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
      {armed ? <AppKitBridge onApi={onApi} onSnapshot={onSnapshot} onSettled={onSettled} /> : null}
      {children}
    </HederaWalletConnectContext.Provider>
  );
};

export const useHederaWalletConnect = () => {
  const ctx = useContext(HederaWalletConnectContext);
  if (!ctx) throw new Error("useHederaWalletConnect must be used inside HederaWalletConnectProvider");
  return ctx;
};
