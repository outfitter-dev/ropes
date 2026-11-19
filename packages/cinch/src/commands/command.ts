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
