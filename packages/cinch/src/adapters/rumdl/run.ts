import type { FileOutcome, StepInput, StepOutcome } from "../adapter.ts";
import { allIncomplete, inChunks } from "../batch.ts";
import { exec } from "../exec.ts";
import { readFences } from "./fences.ts";
import type { Fences } from "./fences.ts";
import { parseOutput } from "./output.ts";
import type { Parsed } from "./output.ts";

const ID = "rumdl";

const incomplete = (reason: string): StepOutcome => ({
  findings: [],
  reason,
  status: "incomplete",
});

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

const outcomeFor = (parsed: Parsed, fences: Fences): StepOutcome => {
  if (!parsed.ok) {
    return incomplete(`${ID} ran, but ${parsed.message}`);
  }
  if (!fences.ok) {
    return incomplete(`${ID} ran, but ${fences.message}`);
  }
  const findings = [...parsed.findings, ...fences.findings].toSorted(
    (a, b) => a.range.start.line - b.range.start.line
  );
  return { findings, status: findings.length > 0 ? "findings" : "passed" };
};

/**
 * One start of rumdl on some files. It exits 0 when clean, 1 when findings
 * remain and 2 when it could not run. The files are the plan's, so rumdl's
 * own exclude patterns are switched off: with them on, it leaves a file out
 * and says nothing, and that file would count as passed.
 */
const start = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> => {
  const { exitCode, stderr, stdout } = await exec(
    [
      Bun.which(command) ?? command,
      "check",
      ...flags,
      "--no-cache",
      "--no-exclude",
      "--output-format",
      "json",
      "--",
      ...input.paths,
    ],
    input.root
  );
  if (exitCode !== 0 && exitCode !== 1) {
    const detail = firstLine(stderr) || "no message";
    return allIncomplete(input, `${ID} exited ${exitCode}: ${detail}`);
  }
  const parsed = parseOutput(stdout, { paths: input.paths, source: ID });
  if (!parsed.ok) {
    return allIncomplete(input, `${ID} ran, but ${parsed.message}`);
  }
  const fences = readFences(stderr, { paths: input.paths, source: ID });
  if (!fences.ok) {
    return allIncomplete(input, `${ID} ran, but ${fences.message}`);
  }
  // A fence warning is a report too: it comes on stderr, not in the JSON.
  const reported = [...parsed.files.values(), ...fences.files.values()].some(
    (file) => !file.ok || file.findings.length > 0
  );
  if (exitCode === 1 && !reported) {
    return allIncomplete(input, `${ID} exited 1 without reporting a finding`);
  }
  return input.paths.map((path) => {
    const mine = parsed.files.get(path);
    const fenced = fences.files.get(path);
    return {
      ...(mine === undefined || fenced === undefined
        ? incomplete(`${ID} gave no answer for this file`)
        : outcomeFor(mine, fenced)),
      path,
    };
  });
};

/**
 * Runs rumdl on a batch. See `inChunks` for how the files are split.
 */
export const runBatch = (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> =>
  inChunks(input, (part) => start(command, part, flags));
