import { z } from "zod";

import { ToolStatusSchema } from "./doctor.ts";
import { ResultSchema } from "./result.ts";

/** An observed attempt, kept separately from its author's recommendation. */
export const RepairInputSchema = z.object({
  convention: z.object({
    authored: z.object({
      failing: z.string(),
      passing: z.string(),
      rationale: z.string().min(1),
    }),
    file: z.string().min(1),
    hash: z.string().min(1),
    rule: z.string().min(1),
  }),
  edit: z.object({
    baseFiles: z.record(z.string().min(1), z.string()),
    baseRevision: z.string().min(1),
    patch: z.string(),
  }),
  event: z.object({
    host: z.literal("claude-code"),
    id: z.string().min(1),
    session: z.string().min(1),
  }),
  original: ResultSchema,
  policy: z.object({
    file: z.string().min(1),
    hash: z.string().min(1),
  }),
  repository: z.string().min(1),
  result: ResultSchema,
  tools: z.array(ToolStatusSchema),
});
export type RepairInput = z.infer<typeof RepairInputSchema>;

export const RepairRecordSchema = RepairInputSchema.extend({
  capturedAt: z.iso.datetime(),
  evidence: z.literal("observed"),
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
}).readonly();
export type RepairRecord = z.infer<typeof RepairRecordSchema>;
