import { z } from "zod";

import { PackStateSchema, ProvenanceSchema, SCHEMA_VERSION } from "./plan.ts";

/**
 * `on` runs. `off` is named in the config's `rules.off`. `not-relevant` has
 * no file here that it is about. `not-enabled` would run, and does not
 * because the repository has not switched rules on.
 */
export const RuleStandingSchema = z.enum([
  "on",
  "off",
  "not-relevant",
  "not-enabled",
]);
export type RuleStanding = z.infer<typeof RuleStandingSchema>;

export const RulesPackSchema = PackStateSchema.unwrap()
  .extend({
    rules: z
      .array(
        z
          .object({
            id: z.string().min(1),
            off: ProvenanceSchema.optional(),
            state: RuleStandingSchema,
          })
          .readonly()
      )
      .readonly(),
    state: RuleStandingSchema,
  })
  .readonly();
export type RulesPack = z.infer<typeof RulesPackSchema>;

/** Provisional and unstable. The rule packs Cinch ships, as they stand here. */
export const RulesReportSchema = z
  .object({
    /** Whether the repository has switched rules on. */
    enabled: z.boolean(),
    /** The folders of its own rules the repository names, when it does. */
    localRules: z
      .object({
        folders: z.array(z.string().min(1)).readonly(),
        source: ProvenanceSchema,
      })
      .readonly()
      .optional(),
    packs: z.array(RulesPackSchema).readonly(),
    schemaVersion: z.literal(SCHEMA_VERSION),
  })
  .readonly();
export type RulesReport = z.infer<typeof RulesReportSchema>;
