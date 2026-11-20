import { z } from "zod";

import { ConflictSchema } from "./conflict.ts";
import { FindingSchema } from "./finding.ts";
import { PlanSchema, SCHEMA_VERSION } from "./plan.ts";

export const StepStatusSchema = z.enum([
  "passed",
  "findings",
  "fixed",
  "incomplete",
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepResultSchema = z
  .object({
    adapter: z.string().min(1),
    findings: z.array(FindingSchema).readonly(),
    path: z.string().min(1),
    /** Why the step is incomplete, when it is. */
    reason: z.string().optional(),
    status: StepStatusSchema,
  })
  .readonly();
export type StepResult = z.infer<typeof StepResultSchema>;

export const OutcomeSchema = z.enum(["clean", "findings", "incomplete"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** Incomplete beats findings, and findings beat clean. */
export const outcomeOf = (steps: readonly StepResult[]): Outcome => {
  if (steps.some((step) => step.status === "incomplete")) {
    return "incomplete";
  }
  if (steps.some((step) => step.status === "findings")) {
    return "findings";
  }
  return "clean";
};

/** Provisional and unstable. What a run did, next to the plan it ran. */
export const ResultSchema = z
  .object({
    /**
     * Present when steps of a `fix` run undid each other. Each is also a
     * finding in `steps`, so the outcome already counts it.
     */
    conflicts: z.array(ConflictSchema).min(1).readonly().optional(),
    outcome: OutcomeSchema,
    plan: PlanSchema,
    schemaVersion: z.literal(SCHEMA_VERSION),
    steps: z.array(StepResultSchema).readonly(),
  })
  .refine((result) => result.outcome === outcomeOf(result.steps), {
    message: "outcome does not agree with the step statuses",
    path: ["outcome"],
  })
  .readonly();
export type Result = z.infer<typeof ResultSchema>;

/** 0 clean, 1 findings remain, 2 incomplete or unusable. */
export const EXIT_CODE = { clean: 0, findings: 1, incomplete: 2 } as const;
export type ExitCode = (typeof EXIT_CODE)[Outcome];

/**
 * The one place a result becomes an exit code. It reads the steps, not the
 * recorded outcome, so a result that was edited or built by hand cannot exit
 * with a code its steps do not support.
 */
export const exitCodeOf = (result: Pick<Result, "steps">): ExitCode =>
  EXIT_CODE[outcomeOf(result.steps)];
