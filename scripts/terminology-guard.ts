#!/usr/bin/env bun

import { spawnSync } from "bun";

import { exceptions, registryFiles } from "./terminology-allowlist.ts";

const retired = "cinch";
const matchesName = new RegExp(retired, "iu");
const decoder = new TextDecoder();

const names = spawnSync(["git", "ls-files", "-z"], { stderr: "inherit" });
if (names.exitCode !== 0) {
  process.exit(names.exitCode);
}

const matches = spawnSync(
  [
    "git",
    "--no-pager",
    "grep",
    "--no-color",
    "--no-column",
    "--no-heading",
    "--no-break",
    "--full-name",
    "--no-textconv",
    "--no-recurse-submodules",
    "-F",
    "-I",
    "-i",
    "-n",
    "-z",
    "-A0",
    "-B0",
    "-e",
    retired,
    "--",
  ],
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
  Object.entries(exceptions).map(([file, { lines }]) => [file, [...lines]])
);
const records = /(?<file>[^\0]+)\0(?<line>\d+)\0(?<text>[^\n]*)\n/gu;
const output = decoder.decode(matches.stdout);
let consumed = 0;
for (const match of output.matchAll(records)) {
  if (match.index !== consumed) {
    break;
  }
  consumed += match[0].length;
  const { file, line, text } = match.groups ?? {};
  if (file !== undefined && registryFiles.includes(file)) {
    continue;
  }
  if (file !== undefined && Object.hasOwn(exceptions, file)) {
    const remaining = permitted.get(file);
    const previous = remaining?.indexOf(text ?? "") ?? -1;
    if (previous !== -1) {
      remaining?.splice(previous, 1);
      continue;
    }
  }
  violations.push(`${file}:${line}: ${text}`);
}

if (consumed !== output.length) {
  violations.push("Could not parse all tracked-text search output.");
}
for (const [file, remaining] of permitted) {
  for (const line of remaining) {
    violations.push(`${file}: remove unused historical allowance: ${line}`);
  }
}

if (violations.length > 0) {
  console.error(`Retired product name found:\n${violations.join("\n")}`);
  process.exitCode = 1;
}
