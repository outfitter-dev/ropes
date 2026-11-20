import path from "node:path";

import type { FileOutcome, StepInput } from "../adapter.ts";
import { allIncomplete, inChunks } from "../batch.ts";
import { exec } from "../exec.ts";
import { readLocal, refusedFile } from "./local.ts";
import type { LocalRules } from "./local.ts";
import { parseOutput } from "./output.ts";
import { shippedIds, shippedRules } from "./rules.ts";

type Local = Extract<LocalRules, { ok: true }>;

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
 * count as checked. A local rule the engine refuses fails every file the
 * same way, so the file it names is remembered and a later start of this
 * batch does not ask the engine again.
 */
const start = async (
  binary: string,
  source: string,
  input: StepInput,
  local: Local,
  remembered: { reason?: string }
): Promise<FileOutcome[]> => {
  if (remembered.reason !== undefined) {
    return allIncomplete(input, remembered.reason);
  }
  const rules = [shippedRules(input.rules), ...local.texts]
    .filter((text) => text !== "")
    .join("\n---\n");
  const { exitCode, stderr, stdout } = await exec(
    [binary, "scan", "--inline-rules", rules, "--json=compact", ...input.paths],
    input.root
  );
  const said = errorCount(exitCode, stderr);
  if (said === null) {
    const refused = await refusedFile(binary, input.root, local.files);
    if (refused !== null) {
      remembered.reason = refused;
    }
    return allIncomplete(
      input,
      refused ?? `${source} exited ${exitCode}: ${firstLine(stderr)}`
    );
  }
  const parsed = parseOutput(stdout, source, local.ids);
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
 * Runs the shipped rules that are on, and the repository's own from the
 * `folders` it names, on a batch. The engine starts in the repository root,
 * and a rule's own `files` globs are read from there.
 */
export const scanBatch = async (
  binary: string,
  source: string,
  input: StepInput,
  folders: readonly string[] = []
): Promise<FileOutcome[]> => {
  const local = await readLocal(input.root, folders, shippedIds);
  if (!local.ok) {
    return allIncomplete(input, local.message);
  }
  const present = await Promise.all(
    input.paths.map((file) => Bun.file(path.join(input.root, file)).exists())
  );
  const paths = input.paths.filter((_, index) => present[index] === true);
  const remembered: { reason?: string } = {};
  const scanned =
    paths.length === 0 ||
    (input.rules?.length === 0 && local.texts.length === 0)
      ? []
      : await inChunks({ ...input, paths }, (part) =>
          start(binary, source, part, local, remembered)
        );
  const byPath = new Map(scanned.map((outcome) => [outcome.path, outcome]));
  // Only a file another adapter keeps is planned before it exists. Its
  // keeper reports that it is missing, and there is nothing here to match.
  return input.paths.map(
    (file) => byPath.get(file) ?? { findings: [], path: file, status: "passed" }
  );
};
