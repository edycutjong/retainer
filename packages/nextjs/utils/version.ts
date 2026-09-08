/**
 * The released version, as one string, read from the root package.json at build time.
 *
 * `yarn release:<patch|minor|major>` bumps that manifest and tags the same commit, so this
 * value and the git tag the GitHub Release was cut from are the same thing by construction.
 * The fallback exists only for a stray build with no injected env — it is deliberately not a
 * plausible-looking version, so a broken pipeline is visible rather than quietly wrong.
 */
export const APP_VERSION = `v${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0-dev"}`;

/** Where the badge, the footer and the deck all point: the releases list, not a commit range. */
export const RELEASES_URL = "https://github.com/edycutjong/retainer/releases";

/** The current release's own page — what the version number links to. */
export const RELEASE_URL = `${RELEASES_URL}/tag/${APP_VERSION}`;
