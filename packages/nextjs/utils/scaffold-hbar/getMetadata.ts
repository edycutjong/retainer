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

export const getMetadata = ({
  title,
  description,
  imageRelativePath = "/og-image.png",
}: {
  title: string;
  description: string;
  imageRelativePath?: string;
}): Metadata => {
  const imageUrl = `${baseUrl}${imageRelativePath}`;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: title,
      template: titleTemplate,
    },
    description: description,
    openGraph: {
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [
        {
          url: imageUrl,
          width: 2400,
          height: 1260,
          alt: "Retainer — 1 signature, 4 unattended renewals: the access window drains to zero and the network's own scheduled call refills it",
        },
      ],
    },
    twitter: {
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [imageUrl],
    },
    icons: {
      icon: [{ url: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    },
  };
};
