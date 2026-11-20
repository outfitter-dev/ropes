import { z } from "zod";

import { SCHEMA_VERSION } from "./plan.ts";
import { ResultSchema } from "./result.ts";

/**
 * Provisional and unstable. What `fix` did: the run, the files whose content
 * differs afterwards, and the change itself as a unified diff.
 */
export const FixReportSchema = z
  .object({
    /** Root-relative, in plan order. In a dry run, what would change. */
    changed: z.array(z.string().min(1)).readonly(),
    /** Unified diff of every changed file. Empty when nothing changed. */
    diff: z.string(),
    /** True when the steps ran on a copy and the checkout was not touched. */
    dryRun: z.boolean(),
    result: ResultSchema,
    schemaVersion: z.literal(SCHEMA_VERSION),
    /**
     * Why nothing was fixed. Present when the Cinch setup has to be repaired
     * first. Then `result` holds the setup steps, and no file was written.
     */
    stopped: z.string().optional(),
  })
  .readonly();
export type FixReport = z.infer<typeof FixReportSchema>;
