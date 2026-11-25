import { z } from "zod";

import { SharedFactsSchema } from "./facts.ts";
import { PackageTargetSchema, TargetDecisionSchema } from "./targets.ts";

/**
 * Provisional and unstable. The schema version covers the plan, the result
 * and the finding together until the shapes are ratified. A consumer that
 * meets a version it does not know must stop, never guess.
 */
export const SCHEMA_VERSION = 5;

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
    /** Only present when this planned value was resolved from a UTC deadline. */
    blockingAt: z.iso.datetime({ precision: 3 }).optional(),
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

/** A bundled method an adapter may use after a specific engine failure. */
export const RecoverySchema = z
  .object({
    /** The immutable bundled dependency providing this engine. */
    package: z.string().min(1),
    platform: z.enum(["darwin", "linux", "win32"]),
    tool: z.string().min(1),
    version: z.string().min(1),
    /** The precise failure that permits this recovery method to run. */
    when: z.string().min(1),
  })
  .readonly();
export type Recovery = z.infer<typeof RecoverySchema>;

export const PlanStepSchema = z
  .object({
    /** Adapter id from the registry. */
    adapter: z.string().min(1),
    /** A required policy fact could not be decided. The step cannot run. */
    incomplete: z.string().optional(),
    /** Conditional recovery declared before the primary engine runs. */
    recovery: RecoverySchema.optional(),
    /**
     * True when what the step keeps is the Ropes setup. Then `doctor --fix`
     * writes it, and `fix` only checks it.
     */
    setup: z.boolean().optional(),
    /** Declared API support evidence consumed by this engine start. */
    target: PackageTargetSchema.optional(),
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
 * One start of an engine for a set of selected files. The batches are
 * what `check` and `fix` run, in this order.
 */
export const PlanBatchSchema = PlanStepSchema.unwrap()
  .extend({
    /** The root-relative package directory. `.` is the workspace itself. */
    package: z.string().min(1),
    /** Root-relative files, in plan order. Never empty. */
    paths: z.array(z.string().min(1)).min(1).readonly(),
    /** The rules the start runs, for an adapter that ships rule packs. */
    rules: z.array(z.string().min(1)).readonly().optional(),
    /** Project scope. Absent for adapters that operate on independent files. */
    unit: z.enum(["package", "workspace"]).optional(),
  })
  .readonly();
export type PlanBatch = z.infer<typeof PlanBatchSchema>;

/**
 * The part a kept file plays in a tool's config. `preset` is what Ropes
 * ships, `generated` is written from the Ropes config and extends it, and
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
    /** Package support conditions for the selected checks. */
    targets: z.array(TargetDecisionSchema).readonly().optional(),
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
    /** This pack can be adopted only by naming it explicitly. */
    explicitOnly: z.boolean().optional(),
    /** The first file found that makes the pack apply. Absent when none. */
    found: z.string().min(1).optional(),
    name: z.string().min(1),
    /** The setting that names the pack, so it runs. Absent when none does. */
    named: ProvenanceSchema.optional(),
    /** The setting that turns the whole pack off. */
    off: ProvenanceSchema.optional(),
    relevant: z.array(z.string().min(1)).readonly(),
    rules: z
      .array(
        z
          .object({
            digest: z.string().optional(),
            id: z.string().min(1),
            identity: z.literal("single-json-document").optional(),
            off: ProvenanceSchema.optional(),
          })
          .readonly()
      )
      .readonly(),
  })
  .readonly();
export type PackState = z.infer<typeof PackStateSchema>;

/**
 * Folders of the repository's own rules, each with the setting that names
 * it: the Ropes config, or an engine's own project config.
 */
export const LocalRulesSchema = z
  .array(
    z.object({ folder: z.string().min(1), source: ProvenanceSchema }).readonly()
  )
  .readonly();

/** The clock a command supplied to the resolver. */
export const EvaluationSchema = z
  .object({
    at: z.iso.datetime({ precision: 3 }),
    simulated: z.boolean(),
  })
  .readonly();
export type Evaluation = z.infer<typeof EvaluationSchema>;

/** What `explain` prints and what `check` and `fix` execute. */
export const PlanSchema = z
  .object({
    /** In execution order. Each step of each path is in exactly one. */
    batches: z.array(PlanBatchSchema).readonly(),
    evaluation: EvaluationSchema.unwrap()
      .extend({ nextTransitionAt: z.iso.datetime({ precision: 3 }).optional() })
      .readonly()
      .optional(),
    /**
     * Present when a tool in the plan has settings of its own for facts the
     * Ropes config can state. A run then compares them.
     */
    facts: SharedFactsSchema.optional(),
    /** The folders of its own rules the repository names, when it does. */
    localRules: LocalRulesSchema.optional(),
    paths: z.array(PlannedPathSchema).readonly(),
    root: z.string().min(1),
    /** Present when policy asks for an adapter that ships rule packs. */
    rules: z.array(PackStateSchema).readonly().optional(),
    schemaVersion: z.literal(SCHEMA_VERSION),
    selection: SelectionSchema,
  })
  .readonly();
export type Plan = z.infer<typeof PlanSchema>;
