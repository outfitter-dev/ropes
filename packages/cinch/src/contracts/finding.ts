import { z } from "zod";

import { EnforcementSchema } from "./enforcement.ts";

/** One-based line and column in the authored source file. */
export const PositionSchema = z
  .object({
    column: z.number().int().min(1),
    line: z.number().int().min(1),
  })
  .readonly();
export type Position = z.infer<typeof PositionSchema>;

export const RangeSchema = z
  .object({
    /** Absent when the tool reports a single point. */
    end: PositionSchema.optional(),
    start: PositionSchema,
  })
  .readonly();
export type Range = z.infer<typeof RangeSchema>;

export const SeveritySchema = z.enum(["error", "warning"]);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Provisional and unstable. One diagnostic from one tool. A mapped diagnostic,
 * such as one inside a Markdown fence, points at the authored file.
 */
export const FindingSchema = z
  .object({
    /** Effective repository policy. Absent preserves the blocking default. */
    enforcement: EnforcementSchema.optional(),
    fixable: z.boolean(),
    message: z.string(),
    /** The engine's diagnostic ID when a shipped compatibility rule names it. */
    nativeRule: z.string().min(1).optional(),
    /** Root-relative path of the authored file. */
    path: z.string().min(1),
    range: RangeSchema,
    /** The tool's own rule id. */
    rule: z.string().min(1),
    severity: SeveritySchema,
    /** The adapter that reported it. */
    source: z.string().min(1),
  })
  .readonly();
export type Finding = z.infer<typeof FindingSchema>;
