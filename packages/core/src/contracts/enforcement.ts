import { z } from "zod";

import { ProvenanceSchema } from "./plan.ts";

export const EnforcementLevelSchema = z.enum(["advisory", "blocking"]);
export type EnforcementLevel = z.infer<typeof EnforcementLevelSchema>;

export const EnforcementSettingSchema = z.union(
  [
    EnforcementLevelSchema,
    z.iso.date({ error: "Use a real, quoted UTC date in YYYY-MM-DD form." }),
  ],
  {
    error:
      'Use "advisory", "blocking", or a quoted UTC date in YYYY-MM-DD form.',
  }
);
export type EnforcementSetting = z.infer<typeof EnforcementSettingSchema>;

export const EnforcementSchema = z
  .object({ level: EnforcementLevelSchema, source: ProvenanceSchema })
  .readonly();

export const ENFORCEMENT_PREFIX = "rules.enforcement.";
