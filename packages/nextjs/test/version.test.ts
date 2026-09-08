import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The version string is three lines of code and one promise: that the number on the badge, the
 * git tag the GitHub Release was cut from, and the manifest `yarn release:*` bumps are the same
 * thing. Nothing in the running app can detect a break — a wrong tag renders as a perfectly
 * ordinary link that 404s, and a missing env renders as a perfectly ordinary version number.
 * So the promise is checked here instead.
 *
 * The module reads `process.env` at import time, so every case re-imports it under a stubbed
 * environment rather than asserting against whatever the runner happened to start with.
 */

const ROOT_MANIFEST = path.resolve(__dirname, "../../../package.json");

async function importVersionWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv("NEXT_PUBLIC_APP_VERSION", undefined as unknown as string);
  else vi.stubEnv("NEXT_PUBLIC_APP_VERSION", value);
  return import("~~/utils/version");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the released version — one string, three places it has to agree with", () => {
  it("prefixes the injected build version with exactly one 'v', so the badge and the git tag are the same token", async () => {
    const { APP_VERSION } = await importVersionWith("1.2.3");
    expect(APP_VERSION).toBe("v1.2.3");
    // The recurring defect is a doubled prefix: the pipeline injects "v1.2.3" and the template
    // adds another. A tag of "vv1.2.3" exists nowhere on GitHub.
    expect(APP_VERSION.startsWith("vv")).toBe(false);
  });

  it("carries whatever the root manifest currently says, which is what `yarn release:*` tags", async () => {
    const manifest = JSON.parse(fs.readFileSync(ROOT_MANIFEST, "utf8")) as { version: string };
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    const { APP_VERSION, RELEASE_URL } = await importVersionWith(manifest.version);
    expect(APP_VERSION).toBe(`v${manifest.version}`);
    expect(RELEASE_URL).toBe(`https://github.com/edycutjong/retainer/releases/tag/v${manifest.version}`);
  });

  it("falls back to a version that is obviously not real, so a build with no injected env is visible rather than quietly wrong", async () => {
    const { APP_VERSION } = await importVersionWith(undefined);
    expect(APP_VERSION).toBe("v0.0.0-dev");
    // The point of the fallback is that nobody mistakes it for a release. A bare "v0.0.0" would
    // be mistakable; the "-dev" suffix is the part that must survive an edit.
    expect(APP_VERSION).toContain("-dev");
  });

  it("points the badge at the releases list and the number at that release's own page", async () => {
    const { APP_VERSION, RELEASES_URL, RELEASE_URL } = await importVersionWith("9.9.9");
    // A commit range, a compare view or a tree URL would all render identically and tell a judge
    // nothing; the contract is the releases list.
    expect(RELEASES_URL).toBe("https://github.com/edycutjong/retainer/releases");
    expect(RELEASE_URL).toBe(`${RELEASES_URL}/tag/${APP_VERSION}`);
    expect(RELEASE_URL.startsWith(RELEASES_URL)).toBe(true);
  });

  it("keeps both links on https and on the project's own repository", async () => {
    const { RELEASES_URL, RELEASE_URL } = await importVersionWith("1.0.0");
    for (const url of [RELEASES_URL, RELEASE_URL]) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.host).toBe("github.com");
      expect(parsed.pathname.startsWith("/edycutjong/retainer/")).toBe(true);
    }
  });
});
