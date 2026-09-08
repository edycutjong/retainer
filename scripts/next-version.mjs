#!/usr/bin/env node
/**
 * Work out the next version from the commits, using the Angular convention.
 *
 *   feat            -> minor
 *   fix | perf      -> patch
 *   type! | footer  -> major        ("BREAKING CHANGE:" or a "!" before the colon)
 *   anything else   -> no release   (docs, chore, style, refactor, test, build, ci)
 *
 * Prints the next version, or "none" when nothing since the last tag is releasable. "none" is a
 * correct outcome, not a failure: a push of only docs and chores should not cut a release.
 *
 *   node scripts/next-version.mjs            # -> 1.1.0 | none
 *   node scripts/next-version.mjs --explain  # the same, with the reasoning on stderr
 *
 * Commits before v1.0.0 are prose, not Angular — this repo's history is judged and was not
 * rewritten to match. They are simply never scanned, because scanning starts at the last tag.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const explain = process.argv.includes("--explain");
const note = (...m) => explain && console.error(...m);

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

let lastTag = "";
try {
  lastTag = git("describe", "--tags", "--abbrev=0");
} catch {
  note("no tag yet — scanning the whole history");
}

// NUL separates the subject from the body, SOH separates commits. Neither can occur in a commit
// message, so this survives multi-line bodies that a plain newline split would tear apart.
const raw = git("log", lastTag ? `${lastTag}..HEAD` : "HEAD", "--no-merges", "--format=%s%x00%b%x01");
const commits = raw
  .split("\x01")
  .map(c => c.trim())
  .filter(Boolean)
  .map(c => {
    const [subject = "", body = ""] = c.split("\x00");
    return { subject: subject.trim(), body: body.trim() };
  });

if (commits.length === 0) {
  note(`nothing since ${lastTag || "the beginning"}`);
  console.log("none");
  process.exit(0);
}

// type(optional-scope)!: subject
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s+(?<subject>.+)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

let level = 0; // 0 none, 1 patch, 2 minor, 3 major
for (const { subject, body } of commits) {
  const m = HEADER.exec(subject);
  if (!m) {
    note(`  skipped (not Angular): ${subject}`);
    continue;
  }
  const { type, breaking } = m.groups;
  let bump = 0;
  if (breaking || BREAKING_FOOTER.test(body)) bump = 3;
  else if (type === "feat") bump = 2;
  else if (type === "fix" || type === "perf") bump = 1;
  note(`  ${["none", "patch", "minor", "major"][bump].padEnd(5)} <- ${subject}`);
  level = Math.max(level, bump);
}

if (level === 0) {
  note("no releasable commit");
  console.log("none");
  process.exit(0);
}

const [major, minor, patch] = version.split(".").map(Number);
const next = { 1: `${major}.${minor}.${patch + 1}`, 2: `${major}.${minor + 1}.0`, 3: `${major + 1}.0.0` }[level];
note(`${version} -> ${next}`);
console.log(next);
