import { z } from "zod";

import { FixReportSchema } from "./fix.ts";

/**
 * The config files of a tool that Ropes has taken over from. `init` removes
 * them only when everything they say reached the new config.
 */
export const RetiredSchema = z
  .object({
    /** Root-relative. Empty when the repository has none. */
    files: z.array(z.string().min(1)).readonly(),
    /** Other traces of the old tool. Ropes names them and removes none. */
    leftovers: z.array(z.string().min(1)).readonly(),
    /** Why the files were left in place, one line each. */
    reasons: z.array(z.string().min(1)).readonly(),
    /** True when they were removed. In a dry run, when they would be. */
    removed: z.boolean(),
  })
  .refine((retired) => !retired.removed || retired.reasons.length === 0, {
    message: "files cannot be removed and kept for a reason at once",
    path: ["removed"],
  })
  .readonly();
export type Retired = z.infer<typeof RetiredSchema>;

/** Provisional and unstable. What `init` did: a fix report, and the above. */
export const InitReportSchema = z
  .object({ ...FixReportSchema.unwrap().shape, retired: RetiredSchema })
  .readonly();
export type InitReport = z.infer<typeof InitReportSchema>;
