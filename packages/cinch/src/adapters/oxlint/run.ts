import path from "node:path";

import type { FileOutcome, StepInput } from "../adapter.ts";
import { allIncomplete, inChunks } from "../batch.ts";
import { exec } from "../exec.ts";
import { whichLocal } from "../local.ts";
import { parseOutput } from "./output.ts";

const ID = "oxlint";

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

const byLine = (findings: FileOutcome["findings"]): FileOutcome["findings"] =>
  findings.toSorted((a, b) => a.range.start.line - b.range.start.line);

/**
 * One start on some files that exist. The linter exits 0 when no error
 * remains and 1 when one does. It counts the files it linted, and a count
 * that differs from the number handed in means it left one out without
 * saying which, so none of them can count as passed.
 */
const start = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> => {
  // The repository's own install first, then the one Cinch itself can see.
  const binary = whichLocal(command, input.root) ?? whichLocal(command);
  if (binary === null) {
    return allIncomplete(input, `${command} could not be found to run`);
  }
  const { exitCode, stderr, stdout } = await exec(
    [binary, "--format", "json", ...flags, "--", ...input.paths],
    input.root
  );
  if (exitCode !== 0 && exitCode !== 1) {
    const detail = firstLine(stderr) || "no message";
    return allIncomplete(input, `${ID} exited ${exitCode}: ${detail}`);
  }
  const parsed = parseOutput(stdout, { paths: input.paths, source: ID });
  if (!parsed.ok) {
    const detail = firstLine(stderr) || firstLine(stdout);
    return allIncomplete(
      input,
      `${ID} ran, but ${parsed.message}${detail === "" ? "" : `: ${detail}`}`
    );
  }
  if (parsed.linted !== input.paths.length) {
    return allIncomplete(
      input,
      `${ID} linted ${parsed.linted} of the ${input.paths.length} files it was given`
    );
  }
  const errors = [...parsed.files.values()]
    .flat()
    .some((finding) => finding.severity === "error");
  if (exitCode === 1 && !errors) {
    return allIncomplete(input, `${ID} exited 1 without reporting an error`);
  }
  return input.paths.map((file) => {
    const findings = byLine(parsed.files.get(file) ?? []);
    return {
      findings,
      path: file,
      status: findings.length > 0 ? "findings" : "passed",
    };
  });
};

/**
 * Runs the linter on a batch, from the repository root, where it reads its
 * own config. Only a file another adapter keeps is planned before it exists.
 * Its keeper reports that it is missing, and there is nothing here to lint.
 */
export const runBatch = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> => {
  const present = await Promise.all(
    input.paths.map((file) => Bun.file(path.join(input.root, file)).exists())
  );
  const paths = input.paths.filter((_, index) => present[index] === true);
  const ran =
    paths.length === 0
      ? []
      : await inChunks({ ...input, paths }, (part) =>
          start(command, part, flags)
        );
  const byPath = new Map(ran.map((outcome) => [outcome.path, outcome]));
  return input.paths.map(
    (file) => byPath.get(file) ?? { findings: [], path: file, status: "passed" }
  );
};
