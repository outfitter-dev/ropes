import { adaptersFor } from "../adapters/registry.ts";
import { check } from "./check.ts";
import type { Command } from "./command.ts";
import { explain } from "./explain.ts";
import { fix } from "./fix.ts";
import type { CommandDeps } from "./prepare.ts";

/**
 * Commands take a typed request and return data. They never parse arguments
 * and never print: `cli.ts` does both. `outfitter` will call these directly.
 */
export const createCommands = (
  deps: CommandDeps
): Readonly<Record<string, Command>> => ({
  check: check(deps),
  explain: explain(deps),
  fix: fix(deps),
});

export const commands = createCommands({ adapters: adaptersFor });
