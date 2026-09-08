"use client";

import React, { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { WalletConnectButton } from "~~/components/scaffold-hbar";
import { useOutsideClick } from "~~/hooks/scaffold-hbar";

type HeaderMenuLink = { label: string; href: string; path: string; external?: boolean };

const CONTRACT_ID = "0.0.10415845";

/**
 * Section navigation. `path` is what "current page" is matched against; hash links share the
 * landing page's path, so only the page itself is ever marked current.
 *
 * "Contract" goes straight to HashScan rather than to an in-app route: the template's `/debug`
 * explorer is disabled in this build (it calls `notFound()`), so a nav item pointing at it
 * promised a contract and delivered a 404.
 */
export const menuLinks: HeaderMenuLink[] = [
  { label: "How it works", href: "/#how", path: "/" },
  { label: "Live view", href: "/#live", path: "/" },
  { label: "Proof", href: "/#proof", path: "/" },
  { label: "For judges", href: "/judge", path: "/judge" },
  { label: "Contract", href: `https://hashscan.io/testnet/contract/${CONTRACT_ID}`, path: "", external: true },
];

const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => {
  const pathname = usePathname();
  return (
    <>
      {menuLinks.map(({ label, href, path, external }) => {
        const isPage = pathname === path && !href.includes("#");
        return (
          <li key={href}>
            {external ? (
              <a href={href} target="_blank" rel="noreferrer" onClick={onNavigate}>
                {label}
              </a>
            ) : (
              <Link href={href} aria-current={isPage ? "page" : undefined} onClick={onNavigate}>
                {label}
              </Link>
            )}
          </li>
        );
      })}
    </>
  );
};

/**
 * Site header.
 *
 * The product's own mark, not the chain's: Hedera is named in the footer where it belongs. The
 * wallet button is the template's and unchanged — connecting a wallet fills the live view's
 * address, which is the one thing a wallet is for on this page.
 */
export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });
  const close = () => burgerMenuRef?.current?.removeAttribute("open");

  return (
    <header className="rt-header">
      <a href="#content" className="rt-skip">
        Skip to content
      </a>
      <div className="rt-container rt-header__inner">
        <div className="flex items-center gap-2 min-w-0">
          <details className="relative lg:hidden" ref={burgerMenuRef}>
            <summary className="rt-burger" aria-label="Open navigation">
              <Bars3Icon className="h-5 w-5" aria-hidden="true" />
            </summary>
            <ul className="rt-menu" style={{ position: "fixed", top: "4rem" }}>
              <NavLinks onNavigate={close} />
            </ul>
          </details>
          <Link href="/" className="rt-brand" aria-label="Retainer — home">
            <Image alt="" src="/icon.svg" width={28} height={28} priority className="rounded-[7px]" />
            <span className="flex flex-col min-w-0">
              <span className="rt-brand__name">Retainer</span>
              <span className="rt-brand__tag rt-eyebrow">access that renews itself</span>
            </span>
          </Link>
        </div>
        <nav aria-label="Sections" className="rt-nav">
          <ul className="flex gap-1 list-none m-0 p-0">
            <NavLinks />
          </ul>
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
};
