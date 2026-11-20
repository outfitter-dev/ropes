import { z } from "zod";

import { SCHEMA_VERSION } from "./plan.ts";

/**
 * `adopt` moves a tool's settings out of the config a person wrote for it
 * and into the Cinch config. `eject` moves them back out.
 */
export const RelocateActionSchema = z.enum(["adopt", "eject"]);
export type RelocateAction = z.infer<typeof RelocateActionSchema>;

/**
 * Provisional and unstable. What `cinch preset adopt` or `eject` did, or
 * would do. Nothing is removed: a file is only ever rewritten.
 */
export const RelocateReportSchema = z
  .object({
    action: RelocateActionSchema,
    /** Root-relative files whose content changes. Empty when nothing moves. */
    changed: z.array(z.string().min(1)).readonly(),
    /** Unified diff of every changed file. */
    diff: z.string(),
    /** What a person should know about the move, such as a lost comment. */
    notes: z.array(z.string()).readonly(),
    preset: z.string().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** Why nothing moved. Present when a person has to act first. */
    stopped: z.array(z.string()).readonly().optional(),
    /** False for a preview: the files are as they were. */
    written: z.boolean(),
  })
  .readonly();
export type RelocateReport = z.infer<typeof RelocateReportSchema>;
