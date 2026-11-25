import { z } from "zod";

import { SCHEMA_VERSION } from "./plan.ts";

/**
 * Provisional and unstable. What `--json` prints on stderr when a command
 * could not run at all, so a script never has to read prose.
 */
export const FailureSchema = z
  .object({
    error: z.object({ message: z.string().min(1) }).readonly(),
    schemaVersion: z.literal(SCHEMA_VERSION),
  })
  .readonly();
export type Failure = z.infer<typeof FailureSchema>;
