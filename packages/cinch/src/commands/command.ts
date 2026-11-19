import { EXIT_CODE } from "../contracts/result.ts";
import type { ExitCode } from "../contracts/result.ts";

export interface CommandRequest {
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly json: boolean;
}

export interface CommandResponse {
  readonly exitCode: ExitCode;
  /** Printed to stdout when present. */
  readonly output?: string;
  /** Printed to stderr when present. */
  readonly error?: string;
}

export type Command = (request: CommandRequest) => Promise<CommandResponse>;

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
export const commands: Readonly<Record<string, Command>> = {
  check: notBuilt("check", "FIT-15"),
  explain: notBuilt("explain", "FIT-14"),
  fix: notBuilt("fix", "FIT-16"),
};
