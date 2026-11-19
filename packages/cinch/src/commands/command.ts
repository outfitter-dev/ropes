import type { ExitCode } from "../contracts/result.ts";

export interface CommandRequest {
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly json: boolean;
  /** Run on a copy and show the change without writing it. */
  readonly dryRun?: boolean;
  /** `init` only: write without asking. `dryRun` wins when both are set. */
  readonly yes?: boolean;
  /** `preset` only: `list`, `add` or `update`. The names follow in `paths`. */
  readonly action?: string;
}

export interface CommandResponse {
  readonly exitCode: ExitCode;
  /** Printed to stdout when present. */
  readonly output?: string;
  /** Printed to stderr when present. */
  readonly error?: string;
  /**
   * Set when the command only showed a change it could make. A caller with a
   * person at a terminal asks `question` and, on yes, runs the command again
   * with `yes`. Any other caller prints `otherwise`.
   */
  readonly confirm?: { readonly question: string; readonly otherwise: string };
}

export type Command = (request: CommandRequest) => Promise<CommandResponse>;
