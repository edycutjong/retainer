import { JetBrains_Mono } from "next/font/google";
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

export const metadata = getMetadata({
  title: "Retainer — access that renews itself",
  description:
    "An x402-gated service on Hedera whose access renews itself on-chain via the Hedera Schedule Service. An agent pays once; the network keeps it alive.",
});

const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" className={mono.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider enableSystem>
          <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldHbarApp;
