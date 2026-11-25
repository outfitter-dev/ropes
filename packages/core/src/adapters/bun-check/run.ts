import path from "node:path";

import type { FileOutcome, StepInput } from "../adapter.ts";
import { allIncomplete, inChunks } from "../batch.ts";
import { exec } from "../exec.ts";
import { parseOutput, summaryOf } from "./output.ts";
import type { Diagnostics } from "./output.ts";

const NAME = "bun check";
const SOURCE = "bun-check";

/**
 * How often the files that are left are checked again after a file that
 * does not parse was taken out.
 */
const ROUNDS = 3;

const lastLine = (text: string): string =>
  text.trim().split("\n").at(-1) ?? "it printed nothing";

/**
 * `--no-script` keeps a `check` package script from running in its place,
 * and `--all` keeps it from grouping errors once there are more than 50.
 */
const run = (binary: string, root: string, paths: readonly string[]) =>
  exec(
    [binary, "check", "--no-script", "--no-pretty", "--all", "--", ...paths],
    root
  );

type Read =
  | ({ readonly ok: true; readonly stopped: boolean } & Diagnostics)
  | { readonly ok: false; readonly reason: string };

/**
 * One run, and whether what it printed can be trusted. It exits 0 with no
 * error and 1 with at least one, and says how many it found. A run whose
 * exit code, count and printed errors do not agree is not used.
 */
const read = async (
  binary: string,
  root: string,
  paths: readonly string[]
): Promise<Read> => {
  const ran = await run(binary, root, paths);
  const parsed = parseOutput(ran.stdout, SOURCE);
  if (!parsed.ok) {
    return { ok: false, reason: `${NAME} ran, but ${parsed.message}` };
  }
  const summary = summaryOf(ran.stderr);
  const printed = parsed.located.length + parsed.global.length;
  const agrees =
    ran.exitCode === 0
      ? summary.clean && printed === 0
      : ran.exitCode === 1 && printed > 0 && summary.found === printed;
  if (!agrees) {
    return {
      ok: false,
      reason: `${NAME} exited ${ran.exitCode} and printed ${printed} errors: ${lastLine(ran.stderr)}`,
    };
  }
  const [first] = parsed.global;
  if (first !== undefined) {
    return { ok: false, reason: `${NAME} could not check: ${first}` };
  }
  // An error in a file that is no source file is one in the compiler config.
  const config = parsed.located.find((error) => error.path.endsWith(".json"));
  return config === undefined
    ? { ...parsed, ok: true, stopped: summary.stopped }
    : {
        ok: false,
        reason: `the compiler config ${config.path} has an error: ${config.message}`,
      };
};

/**
 * Checks the files that exist. The compiler also reads what they import,
 * and an error in a file it was not given is left to the run that is given
 * that file. When a file does not parse, the compiler checks no types at
 * all. That file has its findings, and the others are checked again without
 * it. A file left unchecked in the end is incomplete, never passed.
 */
const checkPresent = async (
  binary: string,
  root: string,
  paths: readonly string[],
  rounds = ROUNDS
): Promise<FileOutcome[]> => {
  const result = await read(binary, root, paths);
  if (!result.ok) {
    return allIncomplete({ package: ".", paths, root }, result.reason);
  }
  const judged = paths.map((file): FileOutcome => {
    const findings = result.located.filter((error) => error.path === file);
    return {
      findings,
      path: file,
      status: findings.length > 0 ? "findings" : "passed",
    };
  });
  if (!result.stopped) {
    return judged;
  }
  const broken = judged.filter((outcome) => outcome.status === "findings");
  const rest = judged
    .filter((outcome) => outcome.status === "passed")
    .map((outcome) => outcome.path);
  if (rest.length === 0) {
    return judged;
  }
  const again =
    broken.length === 0 || rounds <= 1
      ? allIncomplete(
          { package: ".", paths: rest, root },
          `${NAME} checked no types, because a file it reads does not parse`
        )
      : await checkPresent(binary, root, rest, rounds - 1);
  return [...broken, ...again];
};

const start = async (
  binary: string,
  input: StepInput
): Promise<FileOutcome[]> => {
  const present = await Promise.all(
    input.paths.map((file) => Bun.file(path.join(input.root, file)).exists())
  );
  const paths = input.paths.filter((_, index) => present[index] === true);
  const checked =
    paths.length === 0 ? [] : await checkPresent(binary, input.root, paths);
  const byPath = new Map(checked.map((outcome) => [outcome.path, outcome]));
  // Only a file another adapter keeps is planned before it exists. Its
  // keeper reports that it is missing, and there are no types to check.
  return input.paths.map(
    (file) => byPath.get(file) ?? { findings: [], path: file, status: "passed" }
  );
};

/**
 * Type checks a batch from the repository root. The compiler takes each
 * file's options from the nearest compiler config above it.
 */
export const checkBatch = (
  binary: string,
  input: StepInput
): Promise<FileOutcome[]> => inChunks(input, (part) => start(binary, part));
