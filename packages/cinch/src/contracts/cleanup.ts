import { z } from "zod";

import { FindingSchema } from "./finding.ts";
import { PlanSchema } from "./plan.ts";
import { ResultSchema } from "./result.ts";

export const CommitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
export const CleanupPolicySchema = z.strictObject({
  anchor: CommitSchema,
  deadline: z.iso.date().optional(),
  rule: z.string().min(1),
  ruleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  scope: z.array(z.string().min(1)).min(1),
});
export type CleanupPolicy = z.infer<typeof CleanupPolicySchema>;

export interface CleanupRequest {
  readonly at?: string;
  readonly candidate: string;
  readonly cwd: string;
  readonly parent: string;
  /** An approved immutable commit and root-relative JSON file, separated by a colon. */
  readonly policy: string;
}

export const CleanupScanSchema = z.object({
  commit: CommitSchema,
  plan: PlanSchema,
  result: ResultSchema.optional(),
  tree: CommitSchema,
});

export const CleanupReportSchema = z.object({
  at: z.iso.datetime(),
  evidence: z.enum(["planned", "observed", "simulated"]),
  history: z.array(CleanupScanSchema),
  inherited: z.array(FindingSchema),
  introduced: z.array(FindingSchema),
  outcome: z.enum(["clean", "findings", "incomplete"]),
  policy: CleanupPolicySchema.extend({
    commit: CommitSchema,
    file: z.string(),
    sha256: z.string(),
  }),
  reintroduced: z.array(FindingSchema),
  removed: z.array(FindingSchema),
  scans: z.object({
    anchor: CleanupScanSchema,
    candidate: CleanupScanSchema,
    parent: CleanupScanSchema,
  }),
  schemaVersion: z.literal(1),
  uncertainty: z.array(z.string()),
  zero: z.boolean().nullable(),
});
export type CleanupReport = z.infer<typeof CleanupReportSchema>;
export type CleanupScan = z.infer<typeof CleanupScanSchema>;
