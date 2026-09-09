import { JetBrains_Mono, Montserrat } from "next/font/google";
import "@scaffold-hbar-ui/components/styles.css";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

// Self-hosted at build time with size-adjusted fallback metrics, so the countdown, the ledger and
// the command blocks do not reflow when the face arrives — Lighthouse measured 0.27 CLS on /judge
// with the same font loaded from Google's CSS.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-jbm",
});

// The display and UI face, served the same way and for the same reason. It replaces the template's
// remote Styrene A Web @font-face, which arrived late and moved the /judge headline (0.27 CLS).
const sans = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-montserrat",
});

export const metadata = getMetadata({
  title: "Retainer — access that renews itself",
  // 148 chars — under Google's ~155 truncation.
  description:
    "An x402-gated service on Hedera whose access renews itself on-chain via the Hedera Schedule Service. An agent pays once; the network keeps it alive.",
  // 101 chars — the card copy has to survive a mobile feed, which clips around 125.
  cardDescription:
    "An agent pays once, then Hedera renews its access on-chain by itself — 39 renewals, no user, no cron.",
});

const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider enableSystem>
          <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldHbarApp;
