import { z } from "zod";

import { FindingSchema } from "./finding.ts";

/** The rule id of the finding a conflict is reported as. */
export const CONFLICT_RULE = "ropes/fix-conflict";

/**
 * Provisional and unstable. Two steps of one `fix` run that undo each
 * other: a later step rewrote a file, and an earlier step then reported
 * something it had not reported before, on the lines that were rewritten.
 */
export const ConflictSchema = z
  .object({
    /** The later step's change to the lines of the finding, as a diff. */
    diff: z.string().min(1),
    /** What the earlier step's tool reported after the rewrite. */
    finding: FindingSchema,
    /** Root-relative path of the file. */
    path: z.string().min(1),
    /** The adapter whose rule reported the rewritten lines. */
    reportedBy: z.string().min(1),
    /** The adapter that rewrote them. */
    rewrittenBy: z.string().min(1),
    /** The tool's own rule id, the same as `finding.rule`. */
    rule: z.string().min(1),
  })
  .readonly();
export type Conflict = z.infer<typeof ConflictSchema>;

/** A span of one-based lines, both ends included. */
export interface LineSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * The part of a change that touches a span of lines of the new text, as a
 * unified diff. Empty when the change leaves those lines alone.
 */
export type ChangeAt = (
  path: string,
  before: string,
  after: string,
  lines: LineSpan
) => string;
