import { z } from "zod";

import { SCHEMA_VERSION } from "./plan.ts";

/**
 * `current` matches what Cinch ships. `stale` differs and `missing` is not
 * there: `cinch preset update` writes both. `blocked` needs a person, and
 * `off` means the config switches the preset off. `unknown` could not be read.
 */
export const PresetStateSchema = z.enum([
  "current",
  "stale",
  "missing",
  "blocked",
  "off",
  "unknown",
]);
export type PresetState = z.infer<typeof PresetStateSchema>;

export const PresetFileSchema = z
  .object({
    /** Why the file is blocked or unknown. */
    message: z.string().optional(),
    /** Root-relative. */
    path: z.string().min(1),
    state: PresetStateSchema,
  })
  .readonly();
export type PresetFile = z.infer<typeof PresetFileSchema>;

/** Provisional and unstable. The shared configs Cinch keeps in a repository. */
export const PresetReportSchema = z
  .object({
    presets: z
      .array(
        z
          .object({
            files: z.array(PresetFileSchema).readonly(),
            name: z.string().min(1),
          })
          .readonly()
      )
      .readonly(),
    schemaVersion: z.literal(SCHEMA_VERSION),
  })
  .readonly();
export type PresetReport = z.infer<typeof PresetReportSchema>;
