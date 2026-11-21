import { z } from "zod";

import {
  EvaluationSchema,
  ProvenanceSchema,
  SelectionSchema,
  SkippedSchema,
} from "./plan.ts";
import { TargetDecisionSchema } from "./targets.ts";

export const PolicyRuleSchema = z.object({
  adoption: ProvenanceSchema.optional(),
  blockingAt: z.iso.datetime({ precision: 3 }).optional(),
  reason: z.string().min(1),
  rule: z.string().min(1),
  source: ProvenanceSchema.optional(),
  state: z.enum([
    "advisory",
    "blocking",
    "exempt",
    "inapplicable",
    "unresolved",
  ]),
  target: TargetDecisionSchema.optional(),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicySnapshotSchema = z
  .object({
    artifactVersion: z.string().min(1),
    catalog: z.array(z.string().min(1)),
    evaluation: EvaluationSchema.optional(),
    evidence: z.literal("planned"),
    paths: z.array(
      z.object({
        package: z.string().min(1),
        path: z.string().min(1),
        rules: z.array(PolicyRuleSchema),
        skipped: SkippedSchema.optional(),
      })
    ),
    root: z.string().min(1),
    schemaVersion: z.literal(1),
    selection: SelectionSchema,
  })
  .refine(
    (snapshot) =>
      new Set(snapshot.catalog).size === snapshot.catalog.length &&
      new Set(snapshot.paths.map(({ path }) => path)).size ===
        snapshot.paths.length &&
      snapshot.paths.every(
        ({ rules }) =>
          new Set(rules.map(({ rule }) => rule)).size === rules.length &&
          rules.every(({ rule }) => snapshot.catalog.includes(rule))
      ),
    "Every path and rule identity must be unique and belong to the snapshot catalog."
  );
export type PolicySnapshot = z.infer<typeof PolicySnapshotSchema>;

export type PreviewDecision =
  | PolicyRule
  | {
      readonly reason: string;
      readonly state: "absent" | "inapplicable" | "unresolved";
    };

export interface PolicyChange {
  readonly after: PreviewDecision;
  readonly before: PreviewDecision;
  readonly inputs: readonly string[];
  readonly package: string;
  readonly path: string;
  readonly rule: string;
}

type Input = Pick<
  PolicySnapshot,
  "artifactVersion" | "catalog" | "evaluation" | "root" | "selection"
>;

export interface PolicyPreview {
  readonly after: Input & { readonly input: string };
  readonly before: Input & { readonly input: string };
  readonly changes: readonly PolicyChange[];
  readonly evidence: "planned";
  readonly incomplete: readonly string[];
  readonly schemaVersion: 1;
}
