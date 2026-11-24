import { z } from "zod";

import type { Finding } from "../../contracts/finding.ts";

const Position = z.object({
  column: z.number().int().min(0),
  line: z.number().int().min(0),
});

/**
 * One match of `scan --json`, as 0.51.3 prints it. Only the fields Ropes
 * uses are named. Lines and columns are zero-based.
 */
const MatchSchema = z.object({
  /** The path as it was given on the command line. */
  file: z.string().min(1),
  message: z.string(),
  range: z.object({ end: Position, start: Position }),
  replacement: z.string().optional(),
  ruleId: z.string().min(1),
  severity: z.string(),
});

export type Parsed =
  | { readonly ok: true; readonly files: ReadonlyMap<string, Finding[]> }
  | { readonly ok: false; readonly message: string };

const oneBased = (position: z.infer<typeof Position>) => ({
  column: position.column + 1,
  line: position.line + 1,
});

/**
 * Reads what one run printed, and files each match under its path. A match
 * of a rule the repository wrote is reported as `local/<id>`.
 */
export const parseOutput = (
  stdout: string,
  source: string,
  local: ReadonlySet<string> = new Set(),
  fixable: ReadonlySet<string> = new Set()
): Parsed => {
  let json: unknown = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { message: "its output was not JSON", ok: false };
  }
  const parsed = z.array(MatchSchema).safeParse(json);
  if (!parsed.success) {
    return { message: "its output was not in the expected shape", ok: false };
  }
  const files = new Map<string, Finding[]>();
  for (const match of parsed.data) {
    const finding: Finding = {
      fixable:
        match.replacement !== undefined &&
        fixable.has(match.ruleId) &&
        !local.has(match.ruleId),
      message: match.message,
      path: match.file,
      range: {
        end: oneBased(match.range.end),
        start: oneBased(match.range.start),
      },
      rule: local.has(match.ruleId) ? `local/${match.ruleId}` : match.ruleId,
      severity: match.severity === "error" ? "error" : "warning",
      source,
    };
    files.set(match.file, [...(files.get(match.file) ?? []), finding]);
  }
  return { files, ok: true };
};
