#!/usr/bin/env node
// Bumps the project version across every file that tracks it, then (by
// default) creates a "release: vX.Y.Z" commit and a matching git tag.
// Pushing is never automatic — the script prints the push command at the end.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `waterfowl release — bump the version everywhere and tag a release

Usage:
  pnpm release <patch|minor|major> [options]

Options:
  --dry-run     Show what would change; write nothing and run no git commands
  --no-commit   Edit the version files only (implies --no-tag)
  --no-tag      Create the release commit but skip the git tag
  -h, --help    Show this help

Examples:
  pnpm release patch            # 0.2.0 -> 0.2.1, then commit + tag v0.2.1
  pnpm release minor            # 0.2.0 -> 0.3.0
  pnpm release major --dry-run  # preview a 1.0.0 bump

Files updated: package.json, src-tauri/tauri.conf.json,
src-tauri/Cargo.toml, src-tauri/Cargo.lock.

Pushing is never automatic; the script prints the exact push command to run.`;

function fail(msg) {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

// --- parse args ----------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help") || args.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
const noCommit = args.includes("--no-commit");
const noTag = args.includes("--no-tag") || noCommit;
const bump = args.find((a) => !a.startsWith("-"));

if (!["patch", "minor", "major"].includes(bump)) {
  fail(`expected a bump type of patch|minor|major, got "${bump ?? ""}"`);
}

// --- compute next version ------------------------------------------------
const pkgPath = join(ROOT, "package.json");
const pkgRaw = readFileSync(pkgPath, "utf8");
const current = JSON.parse(pkgRaw).version;

if (!/^\d+\.\d+\.\d+$/.test(current)) {
  fail(`current version "${current}" in package.json is not plain X.Y.Z`);
}

const [major, minor, patch] = current.split(".").map(Number);
const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[bump];

const tag = `v${next}`;

// Guard against re-tagging an existing release.
if (!dryRun && !noTag) {
  const existing = git(["tag", "--list", tag]);
  if (existing) fail(`git tag ${tag} already exists`);
}

// --- the four version files ----------------------------------------------
// Each edit is a targeted regex replace so diffs stay minimal and file
// formatting (indentation, key order) is untouched.
const edits = [
  {
    path: pkgPath,
    label: "package.json",
    // First "version" key is the top-level one; deps use package names as keys.
    re: /("version":\s*")([^"]*)(")/,
  },
  {
    path: join(ROOT, "src-tauri/tauri.conf.json"),
    label: "src-tauri/tauri.conf.json",
    re: /("version":\s*")([^"]*)(")/,
  },
  {
    path: join(ROOT, "src-tauri/Cargo.toml"),
    label: "src-tauri/Cargo.toml",
    // The version line inside the [package] table (non-greedy stops at it).
    re: /(\[package\][\s\S]*?\nversion = ")([^"]*)(")/,
  },
  {
    path: join(ROOT, "src-tauri/Cargo.lock"),
    label: "src-tauri/Cargo.lock",
    // The waterfowl package entry's version line.
    re: /(name = "waterfowl"\nversion = ")([^"]*)(")/,
  },
];

console.log(`${current} -> ${next}  (${bump})\n`);

for (const edit of edits) {
  const content = readFileSync(edit.path, "utf8");
  const match = content.match(edit.re);
  if (!match) fail(`could not find a version to replace in ${edit.label}`);
  if (match[2] === next) {
    console.log(`  = ${edit.label} (already ${next})`);
    continue;
  }
  if (dryRun) {
    console.log(`  ~ ${edit.label}: ${match[2]} -> ${next}`);
    continue;
  }
  writeFileSync(edit.path, content.replace(edit.re, `$1${next}$3`));
  console.log(`  ✓ ${edit.label}`);
}

if (dryRun) {
  console.log("\ndry run — nothing written, no git commands run.");
  process.exit(0);
}

// --- git commit + tag ----------------------------------------------------
if (noCommit) {
  console.log(
    `\nFiles updated. Commit and tag manually when ready:\n` +
      `  git commit -am "release: ${tag}" && git tag ${tag}`,
  );
  process.exit(0);
}

git(["add", ...edits.map((e) => e.path)]);
git(["commit", "-m", `release: ${tag}`]);
console.log(`\n  ✓ commit: release: ${tag}`);

if (!noTag) {
  git(["tag", tag]);
  console.log(`  ✓ tag: ${tag}`);
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
console.log(
  `\nReleased ${tag} locally. Push when ready:\n` +
    `  git push origin ${branch}${noTag ? "" : " --tags"}`,
);
