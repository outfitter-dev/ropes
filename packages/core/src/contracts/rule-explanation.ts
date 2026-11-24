import type { PackState, PlannedPath, Plan } from "./plan.ts";
import type { TracedBatch } from "./trace.ts";

/** Authored guidance and scope supplied by an adapter without starting it. */
export interface RuleDefinition {
  readonly id: string;
  readonly source: string;
  readonly message?: string;
  readonly rationale?: string;
  readonly files?: unknown;
  readonly ignores?: unknown;
  readonly metadata?: unknown;
}

export type RuleDefinitions =
  | { readonly ok: true; readonly rules: readonly RuleDefinition[] }
  | { readonly ok: false; readonly error: string };

export interface RuleExplanation {
  readonly schemaVersion: Plan["schemaVersion"];
  readonly evidence: "planned";
  readonly rule: RuleDefinition & { readonly adapter: string };
  readonly pack?: PackState;
  readonly evaluation?: Plan["evaluation"];
  readonly selection: Plan["selection"];
  readonly paths: readonly {
    readonly path: PlannedPath;
    readonly state: "planned" | "excluded" | "inactive";
  }[];
  readonly limitations: readonly string[];
  readonly trace?: readonly TracedBatch[];
}
