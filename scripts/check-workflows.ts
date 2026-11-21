#!/usr/bin/env bun

import { spawn } from "bun";

const commands = [
  ["actionlint", "-shellcheck=", "-pyflakes="],
  [
    "zizmor",
    "--offline",
    "--no-progress",
    "--strict-collection",
    ".github/workflows",
  ],
  ["pinact", "run", "--fix=false", "--no-api"],
];

for (const command of commands) {
  const child = spawn(command, {
    stderr: "inherit",
    stdout: "inherit",
  });
  // eslint-disable-next-line no-await-in-loop -- a failed check stops the gate
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
