"use client";

import { useEffect, useState } from "react";
import { getHederaAccountIdFromSession, getHederaProvider, hasHederaSession, initAppKit } from "./appKitHedera";
import type { HederaProvider } from "@hashgraph/hedera-wallet-connect";
import { hederaNamespace } from "@hashgraph/hedera-wallet-connect";
import { useAppKit, useAppKitAccount, useDisconnect } from "@reown/appkit/react";
import { parseHederaAccountId } from "~~/utils/scaffold-hbar/hederaAccountId";

/**
 * Everything that touches Reown AppKit lives behind this file, and this file is only ever reached
 * through `next/dynamic(..., { ssr: false })`. Two things follow from that, both deliberate:
 *
 *  1. `@reown/appkit` + `@hiero-ledger/sdk` (~1 MB, 70% of it unused on the landing page) leave the
 *     initial bundle. They are fetched when a visitor actually reaches for a wallet.
 *  2. `useAppKit` and friends throw "Please call createAppKit before using ..." when they render
 *     before `createAppKit` has run — which is every server render. Keeping them out of SSR is what
 *     lets the rest of the app prerender to real HTML instead of a spinner.
 */

/** What the provider can drive once a wallet session is possible. */
export type AppKitApi = {
  openConnect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

/** What the provider mirrors into React state. */
export type AppKitSnapshot = {
  provider: HederaProvider | null;
  accountId: string | null;
  hasHederaSession: boolean;
  isConnected: boolean;
};

export type AppKitBridgeProps = {
  /** Called with a stable-enough handle each time AppKit's own callbacks change identity. */
  onApi: (api: AppKitApi) => void;
  /** Called whenever the session or account changes. */
  onSnapshot: (snapshot: AppKitSnapshot) => void;
  /** Called once init settles, successfully or not, so the provider can clear `isInitializing`. */
  onSettled: (error?: unknown) => void;
};

let initPromise: Promise<HederaProvider> | null = null;

/** AppKit is a module singleton, so init runs at most once per page lifetime. */
function ensureInit(): Promise<HederaProvider> {
  if (!initPromise) {
    initPromise = initAppKit().then(() => getHederaProvider());
  }
  return initPromise;
}

const AppKitBridge = ({ onApi, onSnapshot, onSettled }: AppKitBridgeProps) => {
  const [provider, setProvider] = useState<HederaProvider | null>(null);

  useEffect(() => {
    let mounted = true;
    void ensureInit()
      .then(hp => {
        if (mounted) setProvider(hp);
        onSettled();
      })
      .catch(err => {
        console.error("HederaWalletConnect init failed", err);
        onSettled(err);
      });
    return () => {
      mounted = false;
    };
    // Callbacks are ref-backed by the provider; re-running on their identity would re-init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The hooks below must not render until `createAppKit` has resolved, or they throw.
  if (!provider) return null;
  return <AppKitLive provider={provider} onApi={onApi} onSnapshot={onSnapshot} />;
};

const AppKitLive = ({
  provider,
  onApi,
  onSnapshot,
}: {
  provider: HederaProvider;
  onApi: (api: AppKitApi) => void;
  onSnapshot: (snapshot: AppKitSnapshot) => void;
}) => {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const { address, isConnected } = useAppKitAccount({ namespace: hederaNamespace });
  /** Bumps on WalletConnect session events, which React cannot see on its own. */
  const [sessionTick, setSessionTick] = useState(0);

  useEffect(() => {
    onApi({
      openConnect: async () => {
        await open({ view: "Connect", namespace: hederaNamespace });
      },
      disconnect: async () => {
        await disconnect({ namespace: hederaNamespace });
        setSessionTick(t => t + 1);
      },
    });
  }, [open, disconnect, onApi]);

  useEffect(() => {
    const bump = () => setSessionTick(t => t + 1);
    const withEvents = provider as unknown as {
      on?: (event: string, cb: () => void) => void;
      off?: (event: string, cb: () => void) => void;
    };
    if (typeof withEvents.on === "function") {
      withEvents.on("session_update", bump);
      withEvents.on("session_delete", bump);
      withEvents.on("connect", bump);
      withEvents.on("disconnect", bump);
    }
    return () => {
      if (typeof withEvents.off === "function") {
        withEvents.off("session_update", bump);
        withEvents.off("session_delete", bump);
        withEvents.off("connect", bump);
        withEvents.off("disconnect", bump);
      }
    };
  }, [provider]);

  useEffect(() => {
    void sessionTick;
    const fromProvider = getHederaAccountIdFromSession(provider);
    const fromAppKit = isConnected && address ? parseHederaAccountId(address) : null;
    const accountId = fromProvider ?? fromAppKit;

    onSnapshot({
      provider,
      accountId,
      hasHederaSession: hasHederaSession(provider),
      isConnected: Boolean(isConnected && accountId),
    });
  }, [sessionTick, provider, address, isConnected, onSnapshot]);

  return null;
};

export default AppKitBridge;
