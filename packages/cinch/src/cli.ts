#!/usr/bin/env bun
import { parseArgs } from "node:util";

import manifest from "../package.json" with { type: "json" };
import { commands } from "./commands/registry.ts";
import { EXIT_CODE } from "./contracts/result.ts";

const HELP = `cinch ${manifest.version}

Usage: cinch <command> [path...] [--json]

Commands:
  explain   Show the plan for a path without running anything
  check     Run the plan read-only and report findings
  fix       Apply what the plan allows (--dry-run to preview)

Exit codes: 0 clean, 1 findings remain, 2 incomplete or unusable.
`;

const main = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
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
  const response = await command({
    cwd: process.cwd(),
    json: values.json === true,
    paths,
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
