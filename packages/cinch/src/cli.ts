#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import manifest from "../package.json" with { type: "json" };
import type { CommandResponse } from "./commands/command.ts";
import { commands } from "./commands/registry.ts";
import { EXIT_CODE } from "./contracts/result.ts";

const HELP = `cinch ${manifest.version}

Usage: cinch <command> [path...] [--json] [--dry-run] [--yes]

Commands:
  explain   Show the plan for a path without running anything
  check     Run the plan read-only and report findings
  fix       Apply what the plan allows (--dry-run to preview)
  init      Set up the config and presets a repository needs. It shows the
            change and asks first (--yes to write, --dry-run to only show)
  preset    List the shared configs Cinch keeps here and their state
            preset add <name>      Write one preset's files
            preset update [name]   Rewrite copies that are behind

Exit codes: 0 clean, 1 findings remain, 2 incomplete or unusable.
`;

const print = (response: CommandResponse): void => {
  if (response.output !== undefined) {
    process.stdout.write(`${response.output}\n`);
  }
  if (response.error !== undefined) {
    process.stderr.write(`${response.error}\n`);
  }
};

/** Asks a yes or no question. Anything but y or yes is a no. */
const ask = async (question: string): Promise<boolean> => {
  const lines = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await lines.question(`\n${question} [y/N] `);
  lines.close();
  return ["y", "yes"].includes(answer.trim().toLowerCase());
};

const main = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
      "dry-run": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      version: { short: "v", type: "boolean" },
      yes: { short: "y", type: "boolean" },
    },
    strict: false,
  });
  if (values.version === true) {
    process.stdout.write(`${manifest.version}\n`);
    return EXIT_CODE.clean;
  }
  const [name, ...paths] = positionals;
  if (values.help === true || name === undefined) {
    process.stdout.write(HELP);
    return EXIT_CODE.clean;
  }
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) {
    process.stderr.write(
      `cinch: unknown command "${name}". Run cinch --help.\n`
    );
    return EXIT_CODE.incomplete;
  }
  // `preset` takes an action before its names. Every other command takes paths.
  const [action, ...names] = name === "preset" ? paths : [];
  const request = {
    ...(action === undefined ? {} : { action }),
    cwd: process.cwd(),
    dryRun: values["dry-run"] === true,
    json: values.json === true,
    paths: name === "preset" ? names : paths,
    yes: values.yes === true,
  };
  const shown = await command(request);
  print(shown);
  if (!shown.confirm) {
    return shown.exitCode;
  }
  // Only a person at a terminal is asked. Anything else is told what to run.
  const canAsk = process.stdin.isTTY && process.stdout.isTTY && !request.json;
  if (!canAsk) {
    if (!request.json) {
      process.stdout.write(`\n${shown.confirm.otherwise}\n`);
    }
    return shown.exitCode;
  }
  if (!(await ask(shown.confirm.question))) {
    process.stdout.write("Nothing was written.\n");
    return shown.exitCode;
  }
  const written = await command({ ...request, yes: true });
  print(written);
  return written.exitCode;
};

process.exitCode = await main(process.argv.slice(2));
