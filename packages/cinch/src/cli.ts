#!/usr/bin/env bun
import { parseArgs } from "node:util";

import manifest from "../package.json" with { type: "json" };
import { commands } from "./commands/registry.ts";
import { EXIT_CODE } from "./contracts/result.ts";

const HELP = `cinch ${manifest.version}

Usage: cinch <command> [path...] [--json] [--dry-run]

Commands:
  explain   Show the plan for a path without running anything
  check     Run the plan read-only and report findings
  fix       Apply what the plan allows (--dry-run to preview)
  init      Show the config and presets a repository needs (--apply to write)
  preset    List the shared configs Cinch keeps here and their state
            preset add <name>      Write one preset's files
            preset update [name]   Rewrite copies that are behind

Exit codes: 0 clean, 1 findings remain, 2 incomplete or unusable.
`;

const main = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
      apply: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      version: { short: "v", type: "boolean" },
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
  const response = await command({
    ...(action === undefined ? {} : { action }),
    apply: values.apply === true,
    cwd: process.cwd(),
    dryRun: values["dry-run"] === true,
    json: values.json === true,
    paths: name === "preset" ? names : paths,
  });
  if (response.output !== undefined) {
    process.stdout.write(`${response.output}\n`);
  }
  if (response.error !== undefined) {
    process.stderr.write(`${response.error}\n`);
  }
  return response.exitCode;
};

process.exitCode = await main(process.argv.slice(2));
