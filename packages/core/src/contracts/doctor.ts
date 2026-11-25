import { z } from "zod";

import { FactObservationSchema, FactSchema } from "./facts.ts";
import { FixReportSchema } from "./fix.ts";
import { StepResultSchema } from "./result.ts";

export const SettingsReportSchema = z
  .object({
    observations: z.array(FactObservationSchema).readonly(),
    stated: z.array(FactSchema).readonly(),
    steps: z.array(StepResultSchema).readonly(),
  })
  .readonly();
export type SettingsReport = z.infer<typeof SettingsReportSchema>;

/** Whether a tool the plan needs can run here. */
export const ToolStatusSchema = z
  .object({
    /** Present when the tool runs although it is newer than its pin. */
    notice: z.string().optional(),
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
 * keep the Ropes setup, the tools the workspace's plan needs, and, with
 * `--fix`, what was written.
 */
export const DoctorReportSchema = FixReportSchema.unwrap()
  .omit({ stopped: true })
  .extend({
    /** True when the run was asked to repair, not only to report. */
    fix: z.boolean(),
    /**
     * The rule packs that apply here and that the config neither names nor
     * turns off. They do not change the outcome.
     */
    notAdopted: z.array(z.string().min(1)).readonly(),
    /** Shared policy and the observations used to inspect active tool settings. */
    settings: SettingsReportSchema.optional(),
    tools: z.array(ToolStatusSchema).readonly(),
  })
  .readonly();
export type DoctorReport = z.infer<typeof DoctorReportSchema>;
