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

/**
 * The rule rumdl reports under when a tool it runs on a fenced block could not
 * do its work: the tool is missing, or it failed on the block. rumdl stops
 * reading the file there, so the rest of the file was not checked.
 */
const FENCE_TOOL_RULE = "code-block-tools";

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

export type Parsed =
  | { readonly ok: true; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly message: string };

/**
 * Turns rumdl's JSON into findings for one file. rumdl has severities below
 * `warning`. They still fail its run, so they are reported as warnings. A
 * fenced block that a tool could not handle is not a finding: the file was
 * only partly checked, so the output is not usable as a result.
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
  const stopped = parsed.data.find(
    (diagnostic) => diagnostic.rule === FENCE_TOOL_RULE
  );
  if (stopped !== undefined) {
    return {
      message: `it could not check the fenced block at line ${stopped.line}: ${firstLine(stopped.message)}`,
      ok: false,
    };
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
