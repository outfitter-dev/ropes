#!/usr/bin/env bun
import { parseArgs } from "node:util";

import manifest from "../package.json" with { type: "json" };
import type { CommandResponse } from "./commands/command.ts";
import { commands } from "./commands/registry.ts";
import { EXIT_CODE } from "./contracts/result.ts";
import { renderFailureJson } from "./render/failure.ts";

const HELP = `cinch ${manifest.version}

Usage: cinch <command> [path...] [--json] [--dry-run] [--yes]

Commands:
  explain   Show the plan for a path without running anything
  check     Run the plan read-only and report findings
  fix       Apply what the plan allows (--dry-run to preview)
  init      Set up the config and presets a repository needs. It only shows
            the change (--yes to write it)
  preset    List the shared configs Cinch keeps here and their state
            preset add <name>      Write one preset's files
            preset update [name]   Rewrite copies that are behind
  schema    Print the JSON Schema of a command's --json output
            schema [command]       With no command, list the names

Every command prints plain text, or one JSON document with --json. A command
that could not run prints its reason on stderr, as JSON when --json is given.

Exit codes: 0 clean, 1 findings remain, 2 incomplete or unusable.
`;

/** With `--json`, a failure is JSON too, so stderr never needs parsing. */
const print = (response: CommandResponse, json: boolean): void => {
  if (response.output !== undefined) {
    process.stdout.write(`${response.output}\n`);
  }
  if (response.error !== undefined) {
    const text = json ? renderFailureJson(response.error) : response.error;
    process.stderr.write(`${text}\n`);
  }
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
    const error = `cinch: unknown command "${name}". Run cinch --help.`;
    print({ error, exitCode: EXIT_CODE.incomplete }, values.json === true);
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
  const response = await command(request);
  print(response, request.json);
  return response.exitCode;
};

process.exitCode = await main(process.argv.slice(2));
