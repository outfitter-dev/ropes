import path from "node:path";

import type { FileOutcome, StepInput } from "../adapter.ts";
import { allIncomplete, inChunks } from "../batch.ts";
import { exec } from "../exec.ts";
import { parseOutput } from "./output.ts";
import { shippedRules } from "./rules.ts";

const firstLine = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "it printed nothing";

const FOUND = /^Error: (?<count>\d+) error\(s\) found in code\./u;

/**
 * How many error-level matches the engine says it found. It exits 0 and
 * prints nothing when there are none, and exits 1 and prints the count when
 * there are some. Null is anything else: a rule it refuses, or a file it
 * could not read.
 */
const errorCount = (exitCode: number, stderr: string): number | null => {
  if (exitCode === 0) {
    return stderr.trim() === "" ? 0 : null;
  }
  const count = FOUND.exec(stderr.trim())?.groups?.count;
  return exitCode === 1 && count !== undefined ? Number(count) : null;
};

/**
 * One start on some files that exist. A run whose exit code, count and
 * printed matches do not agree is not used, and then none of the files
 * count as checked.
 */
const start = async (
  binary: string,
  source: string,
  input: StepInput
): Promise<FileOutcome[]> => {
  const rules = await shippedRules();
  const { exitCode, stderr, stdout } = await exec(
    [binary, "scan", "--inline-rules", rules, "--json=compact", ...input.paths],
    input.root
  );
  const said = errorCount(exitCode, stderr);
  if (said === null) {
    return allIncomplete(
      input,
      `${source} exited ${exitCode}: ${firstLine(stderr)}`
    );
  }
  const parsed = parseOutput(stdout, source);
  if (!parsed.ok) {
    return allIncomplete(input, `${source} ran, but ${parsed.message}`);
  }
  const errors = [...parsed.files.values()]
    .flat()
    .filter((finding) => finding.severity === "error").length;
  if (errors !== said) {
    return allIncomplete(
      input,
      `${source} said it found ${said} errors and printed ${errors}`
    );
  }
  return input.paths.map((file): FileOutcome => {
    const findings = parsed.files.get(file) ?? [];
    return {
      findings,
      path: file,
      status: findings.length > 0 ? "findings" : "passed",
    };
  });
};

/**
 * Runs the shipped rules on a batch, from the repository root. A rule's own
 * `files` globs are read from there.
 */
export const scanBatch = async (
  binary: string,
  source: string,
  input: StepInput
): Promise<FileOutcome[]> => {
  const present = await Promise.all(
    input.paths.map((file) => Bun.file(path.join(input.root, file)).exists())
  );
  const paths = input.paths.filter((_, index) => present[index] === true);
  const scanned =
    paths.length === 0
      ? []
      : await inChunks({ ...input, paths }, (part) =>
          start(binary, source, part)
        );
  const byPath = new Map(scanned.map((outcome) => [outcome.path, outcome]));
  // Only a file another adapter keeps is planned before it exists. Its
  // keeper reports that it is missing, and there is nothing here to match.
  return input.paths.map(
    (file) => byPath.get(file) ?? { findings: [], path: file, status: "passed" }
  );
};
