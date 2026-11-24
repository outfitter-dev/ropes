#!/usr/bin/env bun

import { spawnSync } from "bun";

import allowlist from "./terminology-allowlist.json" with { type: "json" };

interface Exception {
  readonly reason: string;
  readonly lines?: readonly string[];
}

const exceptions: Readonly<Record<string, Exception>> = allowlist;
const retired = "cinch";
const matchesName = new RegExp(retired, "iu");
const decoder = new TextDecoder();

const names = spawnSync(["git", "ls-files", "-z"], { stderr: "inherit" });
if (names.exitCode !== 0) {
  process.exit(names.exitCode);
}

const matches = spawnSync(
  ["git", "grep", "--no-color", "-I", "-i", "-n", "-z", "-e", retired, "--"],
  { stderr: "inherit" }
);
if (matches.exitCode > 1) {
  process.exit(matches.exitCode);
}

const violations = decoder
  .decode(names.stdout)
  .split("\0")
  .filter((file) => matchesName.test(file))
  .map((file) => `${file} (tracked path)`);

const permitted = new Map(
  Object.entries(exceptions).map(([file, { lines }]) => [
    file,
    lines === undefined ? undefined : [...lines],
  ])
);
const records = /(?<file>[^\0]+)\0(?<line>\d+)\0(?<text>[^\n]*)\n/gu;
for (const match of decoder.decode(matches.stdout).matchAll(records)) {
  const { file, line, text } = match.groups ?? {};
  if (file !== undefined && Object.hasOwn(exceptions, file)) {
    const remaining = permitted.get(file);
    if (remaining === undefined) {
      continue;
    }
    const previous = remaining.indexOf(text ?? "");
    if (previous !== -1) {
      remaining.splice(previous, 1);
      continue;
    }
  }
  violations.push(`${file}:${line}: ${text}`);
}

if (violations.length > 0) {
  console.error(`Retired product name found:\n${violations.join("\n")}`);
  process.exitCode = 1;
}
