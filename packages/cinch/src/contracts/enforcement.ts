import { z } from "zod";

import { ProvenanceSchema } from "./plan.ts";

export const EnforcementLevelSchema = z.enum(["advisory", "blocking"]);
export type EnforcementLevel = z.infer<typeof EnforcementLevelSchema>;

export const EnforcementSchema = z
  .object({ level: EnforcementLevelSchema, source: ProvenanceSchema })
  .readonly();

export const ENFORCEMENT_PREFIX = "rules.enforcement.";
