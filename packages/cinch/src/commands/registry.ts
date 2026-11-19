import { adaptersFor } from "../adapters/registry.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import { check } from "./check.ts";
import type { Command } from "./command.ts";
import { explain } from "./explain.ts";
import type { CommandDeps } from "./prepare.ts";

const notBuilt =
  (name: string, issue: string): Command =>
  () =>
    Promise.resolve({
      error: `cinch ${name} is not built yet (${issue}).`,
      exitCode: EXIT_CODE.incomplete,
    });

/**
 * Commands take a typed request and return data. They never parse arguments
 * and never print: `cli.ts` does both. `outfitter` will call these directly.
 */
export const createCommands = (
  deps: CommandDeps
): Readonly<Record<string, Command>> => ({
  check: check(deps),
  explain: explain(deps),
  fix: notBuilt("fix", "FIT-16"),
});

export const commands = createCommands({ adapters: adaptersFor });
