import { z } from "zod";

import type { FixReport } from "./fix.ts";
import { SCHEMA_VERSION } from "./plan.ts";
import type { RelocateReport } from "./relocate.ts";
import type { ExitCode } from "./result.ts";

/**
 * `current` matches what Ropes ships. `stale` differs and `missing` is not
 * there: `rope preset update` writes both. `blocked` needs a person, and
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

/** Provisional and unstable. The shared configs Ropes keeps in a repository. */
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

export type PresetResponse = (
  | { readonly kind: "list"; readonly report: PresetReport }
  | { readonly kind: "write"; readonly report: FixReport }
  | { readonly kind: "move"; readonly report: RelocateReport }
) & { readonly exitCode: ExitCode };
