import type { ExitCode } from "../contracts/result.ts";

export interface CommandRequest {
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly json: boolean;
  /** Run on a copy and show the change without writing it. */
  readonly dryRun?: boolean;
  /** `doctor` only: repair the setup. Without it, `doctor` only reports. */
  readonly fix?: boolean;
  /**
   * `init`, `preset absorb` and `preset eject`: write the change, which is
   * otherwise only shown. `dryRun` wins when both are set.
   */
  readonly yes?: boolean;
  /**
   * `preset` only: `list`, `add`, `update`, `absorb` or `eject`. The names
   * follow in `paths`.
   */
  readonly action?: string;
}

export interface CommandResponse {
  readonly exitCode: ExitCode;
  /** Printed to stdout when present. */
  readonly output?: string;
  /** Printed to stderr when present. */
  readonly error?: string;
}

export type Command = (request: CommandRequest) => Promise<CommandResponse>;
