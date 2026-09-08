#!/usr/bin/env node
/**
 * Bump the version, tag it, and let CI publish the GitHub Release.
 *
 * The version lives in exactly one place — the root package.json — and everything else reads
 * it from there: the workspaces, the Next.js build (via next.config.ts -> NEXT_PUBLIC_APP_VERSION),
 * the landing page footer, /judge, and the pitch deck's stamp script. The README badge does not
 * read it at all; it asks GitHub for the latest release, so it cannot drift.
 *
 *   yarn release         read the level out of the commits (Angular convention) — the default
 *   yarn release:patch   1.0.0 -> 1.0.1                       — deliberate override
 *   yarn release:minor   1.0.0 -> 1.1.0
 *   yarn release:major   1.0.0 -> 2.0.0
 *
 * CI does the same thing on every push to main; this is the local equivalent, useful for seeing
 * what a push is about to cut before making it.
 *
 * Pushing the tag is deliberately a separate, explicit step — see the printed instructions.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = ["package.json", "packages/nextjs/package.json", "packages/hardhat/package.json"];

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const kind = process.argv[2] ?? "auto";
if (!["auto", "patch", "minor", "major"].includes(kind)) {
  console.error("usage: release.mjs [auto|patch|minor|major]");
  process.exit(1);
}

// A dirty tree means the tag would point at a commit that does not contain the work.
if (git("status", "--porcelain")) {
  console.error("refusing to release: the working tree has uncommitted changes");
  process.exit(1);
}

const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const [major, minor, patch] = rootManifest.version.split(".").map(Number);
if ([major, minor, patch].some(Number.isNaN)) {
  console.error(`refusing to release: "${rootManifest.version}" is not a semantic version`);
  process.exit(1);
}

let next;
if (kind === "auto") {
  // The same calculator CI uses, so a local dry run and a push agree by construction.
  next = execFileSync("node", [join(root, "scripts", "next-version.mjs"), "--explain"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  if (next === "none") {
    console.log("\n  Nothing releasable since the last tag. No release cut.\n");
    process.exit(0);
  }
} else {
  next = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[kind];
}
const tag = `v${next}`;

if (git("tag", "-l", tag)) {
  console.error(`refusing to release: tag ${tag} already exists`);
  process.exit(1);
}

for (const manifest of MANIFESTS) {
  const path = join(root, manifest);
  // Rewritten as text, not re-serialised, so key order and formatting survive untouched.
  const before = readFileSync(path, "utf8");
  const after = before.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`);
  if (before === after) {
    console.error(`refusing to release: no version field found in ${manifest}`);
    process.exit(1);
  }
  writeFileSync(path, after);
}

git("add", ...MANIFESTS);
git("commit", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", tag);

console.log(`\n  ${rootManifest.version} -> ${next}  (tagged ${tag})\n`);
console.log("  Publish it:\n");
console.log(`    git push origin main && git push origin ${tag}\n`);
console.log("  The release workflow then creates the GitHub Release, and the README badge,");
console.log("  the landing page and the deck all follow from it.\n");
