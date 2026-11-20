import type { Plan, PlanBatch } from "./plan.ts";

/** An initial check invocation. Each argument retains its own boundary. */
export interface PlannedInvocation {
  readonly cwd: string;
  readonly argv: readonly string[];
}

export interface CheckDescription {
  readonly invocations: readonly PlannedInvocation[];
  readonly rules: readonly string[];
  /** Authored rule files the maintainer can edit. */
  readonly sources: readonly string[];
  readonly limitations: readonly string[];
}

export type CheckDescriptionResult =
  | { readonly ok: true; readonly value: CheckDescription }
  | { readonly ok: false; readonly error: string };

export interface TracedBatch {
  readonly batch: PlanBatch;
  readonly description: CheckDescriptionResult;
}

export interface CheckTrace {
  readonly schemaVersion: Plan["schemaVersion"];
  readonly evidence: "planned";
  readonly configFile: string | null;
  readonly plan: Plan;
  readonly batches: readonly TracedBatch[];
}
