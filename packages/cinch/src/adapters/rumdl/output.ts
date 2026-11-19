import { z } from "zod";

import type { Finding } from "../../contracts/finding.ts";

/**
 * One entry of `rumdl check --output-format json`, as rumdl 0.3.5 prints it.
 * Only the fields Cinch uses are named. Lines and columns are one-based.
 */
const DiagnosticSchema = z.object({
  column: z.number().int().min(1),
  fixable: z.boolean(),
  line: z.number().int().min(1),
  message: z.string(),
  rule: z.string().min(1),
  severity: z.string(),
});

const OutputSchema = z.array(DiagnosticSchema);

export type Parsed =
  | { readonly ok: true; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly message: string };

/**
 * Turns rumdl's JSON into findings for one file. rumdl has severities below
 * `warning`. They still fail its run, so they are reported as warnings.
 */
export const parseOutput = (
  stdout: string,
  context: { readonly path: string; readonly source: string }
): Parsed => {
  let raw: unknown = null;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { message: "its output was not JSON", ok: false };
  }
  const parsed = OutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { message: "its output was not in the expected shape", ok: false };
  }
  return {
    findings: parsed.data.map((diagnostic) => ({
      fixable: diagnostic.fixable,
      message: diagnostic.message,
      path: context.path,
      range: { start: { column: diagnostic.column, line: diagnostic.line } },
      rule: diagnostic.rule,
      severity: diagnostic.severity === "error" ? "error" : "warning",
      source: context.source,
    })),
    ok: true,
  };
};
