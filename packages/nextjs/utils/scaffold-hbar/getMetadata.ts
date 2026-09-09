import type { Metadata } from "next";

// Absolute URLs for the social card and metadataBase. VERCEL_PROJECT_PRODUCTION_URL is a Vercel
// system variable that only reaches the build when "expose system environment variables" is on;
// it is not on for this project, so the old localhost fallback shipped to production and every
// link unfurl pointed at http://localhost:3000/thumbnail.jpg. The canonical domain is the final
// fallback so a build with no environment at all still produces a card that resolves.
const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://retainer.edycu.dev");
const titleTemplate = "%s | Retainer";

// The social card is its own asset, separate from og-image.png: it is exported at 1x so the file
// is exactly the 1200x630 declared below (a 2400x1260 file gets resampled by each platform's own
// scaler), and it carries a call to action, which is the one thing still legible at feed size.
//
// BUMP THE ?v= WHENEVER THE IMAGE CHANGES. Discord, X and Slack cache the card by URL and offer
// no purge; a regenerated file at an unchanged URL is invisible to everyone who has already seen it.
const SOCIAL_CARD = "/og-card.png?v=3";
const SOCIAL_CARD_ALT =
  "Retainer social card: one signature buys access, then 46+ unattended renewals executed by the network, with the countdown ring caught refilling to 60:00";

export const getMetadata = ({
  title,
  description,
  cardDescription,
  imageRelativePath = SOCIAL_CARD,
}: {
  title: string;
  /** Feeds <meta name="description">. Google truncates around 155 characters. */
  description: string;
  /** Feeds og: and twitter:. Mobile clips at ~125, earlier than desktop — keep it shorter. */
  cardDescription?: string;
  imageRelativePath?: string;
}): Metadata => {
  const imageUrl = `${baseUrl}${imageRelativePath}`;
  const social = cardDescription ?? description;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: title,
      template: titleTemplate,
    },
    description: description,
    authors: [{ name: "Edy Cu", url: "https://github.com/edycutjong" }],
    creator: "Edy Cu",
    alternates: { canonical: baseUrl },
    openGraph: {
      type: "website",
      url: baseUrl,
      // Discord renders this above the title; without it the card reads as anonymous.
      siteName: "Retainer",
      title: {
        default: title,
        template: titleTemplate,
      },
      description: social,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: SOCIAL_CARD_ALT,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      // Without these the card renders with no byline: X attributes the unfurl to nobody, and
      // the "posted by" credit on a shared link is the only authorship signal most people see.
      site: "@edycutjong",
      creator: "@edycutjong",
      title: {
        default: title,
        template: titleTemplate,
      },
      description: social,
      images: [{ url: imageUrl, alt: SOCIAL_CARD_ALT }],
    },
    icons: {
      icon: [{ url: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    },
  };
};
