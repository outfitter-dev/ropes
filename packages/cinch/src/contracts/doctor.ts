import { z } from "zod";

import { FixReportSchema } from "./fix.ts";

/** Whether a tool the plan needs can run here. */
export const ToolStatusSchema = z
  .object({
    /** Why the tool cannot run. Absent when it can. */
    problem: z.string().optional(),
    tool: z.string().min(1),
    /** The installed version, when the tool reported one. */
    version: z.string().optional(),
    versionRange: z.string().min(1),
  })
  .readonly();
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

/**
 * Provisional and unstable. What `doctor` found: the run of the steps that
 * keep the Cinch setup, the tools the workspace's plan needs, and, with
 * `--fix`, what was written.
 */
export const DoctorReportSchema = FixReportSchema.unwrap()
  .omit({ stopped: true })
  .extend({
    /** True when the run was asked to repair, not only to report. */
    fix: z.boolean(),
    tools: z.array(ToolStatusSchema).readonly(),
  })
  .readonly();
export type DoctorReport = z.infer<typeof DoctorReportSchema>;
