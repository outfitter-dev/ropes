import { z } from "zod";

import type { Finding } from "../../contracts/finding.ts";

const ID = "oxlint";

/**
 * One diagnostic of `oxlint --format json`, as 1.93.0 prints it. Only the
 * fields Cinch uses are named. Lines and columns are one-based. A problem
 * the parser found, such as a syntax error, has no `code`.
 */
const DiagnosticSchema = z.object({
  code: z.string().min(1).optional(),
  /** The path as it was given on the command line. */
  filename: z.string().min(1),
  labels: z
    .array(
      z.object({
        span: z.object({
          column: z.number().int().min(1),
          line: z.number().int().min(1),
        }),
      })
    )
    .optional(),
  message: z.string(),
  severity: z.string(),
});

const OutputSchema = z.object({
  diagnostics: z.array(DiagnosticSchema),
  /** How many files the run linted. */
  number_of_files: z.number().int().min(0),
});

/** The rule a diagnostic without a `code` is filed under. */
const PARSE_RULE = "syntax";

/** What one run said: how many files it linted, and what it found in each. */
export type ParsedRun =
  | {
      readonly ok: true;
      readonly linted: number;
      readonly files: ReadonlyMap<string, readonly Finding[]>;
    }
  | { readonly ok: false; readonly message: string };

const toFinding = (
  diagnostic: z.infer<typeof DiagnosticSchema>,
  source: string
): Finding => ({
  // The report does not say which diagnostics a fix would clear.
  fixable: false,
  message: diagnostic.message,
  path: diagnostic.filename,
  range: { start: diagnostic.labels?.[0]?.span ?? { column: 1, line: 1 } },
  rule: diagnostic.code ?? PARSE_RULE,
  severity: diagnostic.severity === "error" ? "error" : "warning",
  source,
});

const jsonIn = (stdout: string): unknown => {
  // A note can come before the report, such as the one for no files.
  const from = stdout.indexOf("{");
  try {
    return from === -1 ? undefined : JSON.parse(stdout.slice(from));
  } catch {
    return undefined;
  }
};

/**
 * Reads the report of one run. A diagnostic for a file the run was not given
 * makes the whole report unusable: it would otherwise be dropped unseen.
 */
export const parseOutput = (
  stdout: string,
  context: { readonly paths: readonly string[]; readonly source: string }
): ParsedRun => {
  const parsed = OutputSchema.safeParse(jsonIn(stdout));
  if (!parsed.success) {
    return { message: `${ID} printed a report Cinch cannot read`, ok: false };
  }
  const files = new Map<string, Finding[]>(
    context.paths.map((file) => [file, []])
  );
  for (const diagnostic of parsed.data.diagnostics) {
    const mine = files.get(diagnostic.filename);
    if (mine === undefined) {
      return {
        message: `${ID} reported ${diagnostic.filename}, which it was not given`,
        ok: false,
      };
    }
    mine.push(toFinding(diagnostic, context.source));
  }
  return { files, linted: parsed.data.number_of_files, ok: true };
};
