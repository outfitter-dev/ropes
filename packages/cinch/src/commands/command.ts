import type { ExitCode } from "../contracts/result.ts";

export interface ReadRequest {
  readonly cwd: string;
  readonly paths: readonly string[];
  /**
   * Hold every tool to its exact pin. Without it a tool newer than its pin
   * and inside the range its adapter was tested on runs, with a notice.
   */
  readonly strict?: boolean;
}

export interface FixRequest extends ReadRequest {
  /** Run on a copy and show the change without writing it. */
  readonly dryRun?: boolean;
}

export interface CommandRequest extends FixRequest {
  readonly json: boolean;
  /** `doctor` only: repair the setup. Without it, `doctor` only reports. */
  readonly fix?: boolean;
  /**
   * `init`, `preset adopt` and `preset eject`: write the change, which is
   * otherwise only shown. `dryRun` wins when both are set.
   */
  readonly yes?: boolean;
  /**
   * `preset` only: `list`, `add`, `update`, `adopt` or `eject`. The names
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

export type Operation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };
