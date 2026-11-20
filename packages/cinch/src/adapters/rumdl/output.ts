import { z } from "zod";

import type { Finding } from "../../contracts/finding.ts";

/**
 * One entry of `rumdl check --output-format json`, as rumdl 0.3.5 prints it.
 * One run prints one list for all the files it was given.
 * Only the fields Cinch uses are named. Lines and columns are one-based.
 */
const DiagnosticSchema = z.object({
  column: z.number().int().min(1),
  /** The path as it was given on the command line. */
  file: z.string().min(1),
  fixable: z.boolean(),
  line: z.number().int().min(1),
  message: z.string(),
  rule: z.string().min(1),
  severity: z.string(),
});

const OutputSchema = z.array(DiagnosticSchema);

/**
 * The rule rumdl reports under when a tool it runs on a fenced block could not
 * do its work: the tool is missing, or the config does not set
 * `on-error = "warn"` and the tool failed on the block. rumdl then checks no
 * later block in the file.
 */
const FENCE_TOOL_RULE = "code-block-tools";

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

export type Parsed =
  | { readonly ok: true; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly message: string };

/** What one run said, file by file. Not usable when it cannot be read. */
export type ParsedRun =
  | { readonly ok: true; readonly files: ReadonlyMap<string, Parsed> }
  | { readonly ok: false; readonly message: string };

type Diagnostic = z.infer<typeof DiagnosticSchema>;

const forFile = (
  path: string,
  diagnostics: readonly Diagnostic[],
  source: string
): Parsed => {
  const stopped = diagnostics.find(
    (diagnostic) => diagnostic.rule === FENCE_TOOL_RULE
  );
  if (stopped !== undefined) {
    return {
      message: `it could not check the fenced block at line ${stopped.line}: ${firstLine(stopped.message)}`,
      ok: false,
    };
  }
  return {
    findings: diagnostics.map((diagnostic) => ({
      fixable: diagnostic.fixable,
      message: diagnostic.message,
      path,
      range: { start: { column: diagnostic.column, line: diagnostic.line } },
      rule: diagnostic.rule,
      severity: diagnostic.severity === "error" ? "error" : "warning",
      source,
    })),
    ok: true,
  };
};

/**
 * Turns rumdl's JSON into findings for each file of one run. rumdl has
 * severities below `warning`. They still fail its run, so they are reported
 * as warnings. A fenced block that a tool could not handle is not a finding:
 * that file was only partly checked, so it has no usable result. A run that
 * reports on a file it was not given is not usable for any of them.
 */
export const parseOutput = (
  stdout: string,
  context: { readonly paths: readonly string[]; readonly source: string }
): ParsedRun => {
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
  const asked = new Set(context.paths);
  const stray = parsed.data.find((diagnostic) => !asked.has(diagnostic.file));
  if (stray !== undefined) {
    return {
      message: `it reported on ${stray.file}, which it was not given`,
      ok: false,
    };
  }
  return {
    files: new Map(
      context.paths.map((path) => [
        path,
        forFile(
          path,
          parsed.data.filter((diagnostic) => diagnostic.file === path),
          context.source
        ),
      ])
    ),
    ok: true,
  };
};
