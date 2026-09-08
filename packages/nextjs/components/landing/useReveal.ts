"use client";

import { useEffect } from "react";

/**
 * Scroll reveal for `.rt-reveal` elements: one IntersectionObserver, adds `.is-in` once.
 * Under `prefers-reduced-motion` the CSS already shows everything at rest; this still runs so
 * the class is consistent, but nothing moves.
 */
export function useReveal(deps: readonly unknown[] = []) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".rt-reveal:not(.is-in)"));
    if (nodes.length === 0) return;
    if (typeof IntersectionObserver === "undefined") {
      nodes.forEach(n => n.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );
    nodes.forEach(n => io.observe(n));
    // Printing and copy-to-PDF never scroll, so reveal everything before the page is laid out.
    const showAll = () => nodes.forEach(n => n.classList.add("is-in"));
    window.addEventListener("beforeprint", showAll);
    return () => {
      io.disconnect();
      window.removeEventListener("beforeprint", showAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
