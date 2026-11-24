import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { Finding } from "../../contracts/finding.ts";
import type { FileOutcome, StepInput } from "../adapter.ts";

const ErrorSchema = z.object({
  span: z.object({
    column: z.number().int().min(1),
    line: z.number().int().min(1),
  }),
  status: z.object({ text: z.string() }),
  url: z.url(),
});
const OutputSchema = z.object({
  cached: z.literal(0),
  error_map: z.record(z.string(), z.array(ErrorSchema)),
  errors: z.number().int().min(0),
  excluded_map: z.record(z.string(), z.array(z.object({ url: z.url() }))),
  timeouts: z.literal(0),
  unknown: z.literal(0),
  unsupported: z.literal(0),
});
const FILE = "File not found. Check if file exists and path is correct";
const FRAGMENT = "Cannot find fragment";

/** Validate the pinned native report, including ownership of every failure. */
export const readOutput = (
  stdout: string,
  input: StepInput
):
  | {
      readonly ok: true;
      readonly outcomes: FileOutcome[];
      readonly errors: number;
    }
  | { readonly ok: false; readonly reason: string } => {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "the local link report was not JSON" };
  }
  const parsed = OutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason:
        "the local link report was incomplete or had an unsupported shape",
    };
  }
  const selected = new Map(
    input.paths.map((file) => [path.resolve(input.root, file), file])
  );
  if (
    Object.values(parsed.data.excluded_map)
      .flat()
      .some((entry) => new URL(entry.url).protocol === "file:")
  ) {
    return {
      ok: false,
      reason: "the engine excluded a local link that the plan required",
    };
  }
  const reported = new Map<string, z.infer<typeof ErrorSchema>[]>();
  for (const [source, failures] of Object.entries(parsed.data.error_map)) {
    const file = selected.get(path.resolve(input.root, source));
    if (file === undefined) {
      return {
        ok: false,
        reason: `the local link report named an unselected source ${source}`,
      };
    }
    const unsupported = failures.find(
      (failure) =>
        ![FILE, FRAGMENT].includes(failure.status.text) ||
        new URL(failure.url).protocol !== "file:"
    );
    if (unsupported !== undefined) {
      return {
        ok: false,
        reason: `the local link check could not complete: ${unsupported.status.text}`,
      };
    }
    reported.set(file, failures);
  }
  const count = [...reported.values()].reduce(
    (total, failures) => total + failures.length,
    0
  );
  if (count !== parsed.data.errors) {
    return {
      ok: false,
      reason: "the local link error count did not match its diagnostics",
    };
  }
  return {
    errors: count,
    ok: true,
    outcomes: input.paths.map((file) => {
      const failures = reported.get(file) ?? [];
      return {
        findings: failures
          .map((failure): Finding => ({
            fixable: false,
            message: `${failure.status.text}: ${path.relative(input.root, fileURLToPath(failure.url))}${new URL(failure.url).hash}`,
            path: file,
            range: { start: failure.span },
            rule:
              failure.status.text === FILE ? "local-file" : "local-fragment",
            severity: "error",
            source: "lychee",
          }))
          .toSorted(
            (left, right) =>
              left.range.start.line - right.range.start.line ||
              left.range.start.column - right.range.start.column
          ),
        path: file,
        status: failures.length === 0 ? "passed" : "findings",
      };
    }),
  };
};
