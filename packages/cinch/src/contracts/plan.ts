import { z } from "zod";

/**
 * Provisional and unstable. The schema version covers the plan, the result
 * and the finding together until the shapes are ratified. A consumer that
 * meets a version it does not know must stop, never guess.
 */
export const SCHEMA_VERSION = 0;

/** Where a policy value came from. */
export const ProvenanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }).readonly(),
  z
    .object({
      /** Root-relative config file. */
      file: z.string().min(1),
      /** Dotted key inside that file. */
      key: z.string().min(1),
      kind: z.literal("file"),
    })
    .readonly(),
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const PolicyValueSchema = z
  .object({
    key: z.string().min(1),
    source: ProvenanceSchema,
    value: z.union([z.string(), z.number(), z.boolean()]),
  })
  .readonly();
export type PolicyValue = z.infer<typeof PolicyValueSchema>;

/** What the caller asked for, before it was expanded into paths. */
export const SelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace") }).readonly(),
  z
    .object({
      kind: z.literal("paths"),
      /** Root-relative. May be empty: an empty selection is zero files. */
      paths: z.array(z.string().min(1)).readonly(),
    })
    .readonly(),
]);
export type Selection = z.infer<typeof SelectionSchema>;

export const PlanStepSchema = z
  .object({
    /** Adapter id from the registry. */
    adapter: z.string().min(1),
    /** The external tool the adapter drives. */
    tool: z.string().min(1),
    /** The version of the tool the step needs. */
    versionRange: z.string().min(1),
    /** Whether the step may write when run by `fix`. */
    writes: z.boolean(),
  })
  .readonly();
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlannedPathSchema = z
  .object({
    /** Root-relative path. */
    path: z.string().min(1),
    /** The resolved policy for this path, each value with its origin. */
    policy: z.array(PolicyValueSchema).readonly(),
    /** In execution order. Empty means nothing applies to the path. */
    steps: z.array(PlanStepSchema).readonly(),
  })
  .readonly();
export type PlannedPath = z.infer<typeof PlannedPathSchema>;

/** What `explain` prints and what `check` and `fix` execute. */
export const PlanSchema = z
  .object({
    paths: z.array(PlannedPathSchema).readonly(),
    root: z.string().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
    selection: SelectionSchema,
  })
  .readonly();
export type Plan = z.infer<typeof PlanSchema>;
