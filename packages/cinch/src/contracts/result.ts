import type { Plan, SCHEMA_VERSION } from "./plan.ts";

/** Provisional and unstable. FIT-6 defines the real shape. */
export type StepStatus = "passed" | "findings" | "fixed" | "incomplete";

export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly message: string;
  readonly fixable: boolean;
}

export interface StepResult {
  readonly adapter: string;
  readonly path: string;
  readonly status: StepStatus;
  readonly findings: readonly Finding[];
  /** Why the step is incomplete, when it is. */
  readonly reason?: string;
}

export interface Result {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly plan: Plan;
  readonly steps: readonly StepResult[];
}

/** 0 clean, 1 findings remain, 2 incomplete or unusable. Incomplete wins. */
export const EXIT_CODE = { clean: 0, findings: 1, incomplete: 2 } as const;
export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];
