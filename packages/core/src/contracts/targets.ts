import { z } from "zod";

export const TargetConditionSchema = z.object({
  atLeast: z.string().min(1),
  dependency: z.string().min(1),
});
export type TargetCondition = z.infer<typeof TargetConditionSchema>;

/** Declared API support, collected separately from the installed checker. */
export const PackageTargetSchema = z.object({
  dependency: z.string().min(1),
  inheritedBy: z
    .object({ file: z.string(), key: z.string(), sha256: z.string() })
    .optional(),
  package: z.string().min(1),
  range: z.string().optional(),
  reason: z.string().optional(),
  source: z.object({
    file: z.string().min(1),
    key: z.string().min(1),
    sha256: z.string().optional(),
  }),
  state: z.enum(["declared", "absent", "unresolved"]),
});
export type PackageTarget = z.infer<typeof PackageTargetSchema>;

export const TargetDecisionSchema = z.object({
  adapter: z.string().min(1),
  condition: TargetConditionSchema,
  decision: z.enum(["applicable", "inapplicable", "unresolved"]),
  fact: PackageTargetSchema.optional(),
  reason: z.string().min(1),
});
export type TargetDecision = z.infer<typeof TargetDecisionSchema>;
