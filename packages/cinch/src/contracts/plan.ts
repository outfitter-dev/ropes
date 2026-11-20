import { z } from "zod";

import { SharedFactsSchema } from "./facts.ts";

/**
 * Provisional and unstable. The schema version covers the plan, the result
 * and the finding together until the shapes are ratified. A consumer that
 * meets a version it does not know must stop, never guess.
 */
export const SCHEMA_VERSION = 1;

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
    /**
     * True when what the step keeps is the Cinch setup. Then `doctor --fix`
     * writes it, and `fix` only checks it.
     */
    setup: z.boolean().optional(),
    /**
     * A wider range the step also accepts, with a notice, when the installed
     * tool is newer than the pin in `versionRange`. Absent in a strict run.
     */
    tolerates: z.string().min(1).optional(),
    /** The external tool the adapter drives. */
    tool: z.string().min(1),
    /** The version of the tool the step needs. */
    versionRange: z.string().min(1),
    /** Whether the step may write: under `fix`, or `doctor --fix` for setup. */
    writes: z.boolean(),
  })
  .readonly();
export type PlanStep = z.infer<typeof PlanStepSchema>;

/** Why the config leaves a path out, and the setting that decided it. */
export const SkippedSchema = z
  .object({
    reason: z.enum(["excluded", "not-included"]),
    source: ProvenanceSchema,
  })
  .readonly();
export type Skipped = z.infer<typeof SkippedSchema>;

/**
 * One start of an engine: a step on the selected files of one package. The
 * batches are what `check` and `fix` run, in this order.
 */
export const PlanBatchSchema = PlanStepSchema.unwrap()
  .extend({
    /** The root-relative package directory. `.` is the workspace itself. */
    package: z.string().min(1),
    /** Root-relative files, in plan order. Never empty. */
    paths: z.array(z.string().min(1)).min(1).readonly(),
    /** The rules the start runs, for an adapter that ships rule packs. */
    rules: z.array(z.string().min(1)).readonly().optional(),
  })
  .readonly();
export type PlanBatch = z.infer<typeof PlanBatchSchema>;

/**
 * The part a kept file plays in a tool's config. `preset` is what Cinch
 * ships, `generated` is written from the Cinch config and extends it, and
 * `root` is the file the tool finds first, which extends the generated one.
 */
export const LayerSchema = z.enum(["preset", "generated", "root"]);
export type Layer = z.infer<typeof LayerSchema>;

export const PlannedPathSchema = z
  .object({
    /** Present for a file that is one layer of a tool's config. */
    layer: LayerSchema.optional(),
    /** The package the file is checked with. `.` is the workspace itself. */
    package: z.string().min(1),
    /** Root-relative path. */
    path: z.string().min(1),
    /** The resolved policy for this path, each value with its origin. */
    policy: z.array(PolicyValueSchema).readonly(),
    /** Present when the config leaves the path out. Then nothing runs. */
    skipped: SkippedSchema.optional(),
    /** In execution order. Empty means nothing applies to the path. */
    steps: z.array(PlanStepSchema).readonly(),
  })
  .readonly();
export type PlannedPath = z.infer<typeof PlannedPathSchema>;

/**
 * One rule pack an adapter ships, and whether it runs here. A pack is on
 * when a file in the repository matches `relevant` and no setting turns it
 * off. A rule is on when its pack is and no setting turns the rule off.
 */
export const PackStateSchema = z
  .object({
    about: z.string().min(1),
    adapter: z.string().min(1),
    /** The first file found that makes the pack apply. Absent when none. */
    found: z.string().min(1).optional(),
    name: z.string().min(1),
    /** The setting that turns the whole pack off. */
    off: ProvenanceSchema.optional(),
    relevant: z.array(z.string().min(1)).readonly(),
    rules: z
      .array(
        z
          .object({ id: z.string().min(1), off: ProvenanceSchema.optional() })
          .readonly()
      )
      .readonly(),
  })
  .readonly();
export type PackState = z.infer<typeof PackStateSchema>;

/** What `explain` prints and what `check` and `fix` execute. */
export const PlanSchema = z
  .object({
    /** In execution order. Each step of each path is in exactly one. */
    batches: z.array(PlanBatchSchema).readonly(),
    /**
     * Present when a tool in the plan has settings of its own for facts the
     * Cinch config can state. A run then compares them.
     */
    facts: SharedFactsSchema.optional(),
    paths: z.array(PlannedPathSchema).readonly(),
    root: z.string().min(1),
    /** Present when policy asks for an adapter that ships rule packs. */
    rules: z.array(PackStateSchema).readonly().optional(),
    schemaVersion: z.literal(SCHEMA_VERSION),
    selection: SelectionSchema,
  })
  .readonly();
export type Plan = z.infer<typeof PlanSchema>;
