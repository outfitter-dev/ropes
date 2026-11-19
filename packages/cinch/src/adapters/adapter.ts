import type { Finding, StepStatus } from "../contracts/result.ts";

/** The data the resolver needs about an adapter. It carries no behavior. */
export interface AdapterDescriptor {
  readonly id: string;
  readonly tool: string;
  readonly versionRange: string;
  readonly writes: boolean;
  /** File extensions, with the dot, that this adapter handles. */
  readonly extensions: readonly string[];
}

export interface ProbeResult {
  readonly available: boolean;
  readonly version?: string;
  readonly reason?: string;
}

export interface StepOutcome {
  readonly status: StepStatus;
  readonly findings: readonly Finding[];
  readonly reason?: string;
}

export interface StepInput {
  readonly root: string;
  readonly path: string;
}

/**
 * The one seam engines plug into. The runner knows only this interface, and
 * nothing outside an adapter's own folder and the registry names an engine.
 */
export interface Adapter {
  readonly descriptor: AdapterDescriptor;
  readonly probe: () => Promise<ProbeResult>;
  readonly check: (input: StepInput) => Promise<StepOutcome>;
  readonly fix: (input: StepInput) => Promise<StepOutcome>;
}
