import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import type { FileOutcome, StepInput } from "../adapter.ts";
import { exec } from "../exec.ts";
import type { RuleFolder } from "./local.ts";
import { shippedRewrites, shippedRules } from "./rules.ts";
import { scanBatch } from "./run.ts";

/** A rewrite may only touch the regular file the plan named. */
const writable = async (root: string, file: string): Promise<boolean> => {
  try {
    const target = path.join(root, file);
    const [base, location, info] = await Promise.all([
      realpath(root),
      realpath(target),
      lstat(target),
    ]);
    return (
      path.relative(base, location).split(path.sep).join("/") === file &&
      !file.startsWith("../") &&
      info.isFile() &&
      info.nlink === 1
    );
  } catch {
    return false;
  }
};

export const rewriteBatch = async (
  binary: string,
  source: string,
  input: StepInput,
  folders: readonly RuleFolder[] = []
): Promise<FileOutcome[]> => {
  const checked = await scanBatch(binary, source, input, folders);
  if (checked.some((outcome) => outcome.status === "incomplete")) {
    return checked;
  }
  const rules = shippedRules(shippedRewrites(input.rules));
  const rewritten = new Map<string, FileOutcome>();
  for (const outcome of checked) {
    if (!outcome.findings.some((finding) => finding.fixable)) {
      continue;
    }
    const { path: file } = outcome;
    const roots =
      input.sourceRoot === undefined
        ? [input.root]
        : [input.root, input.sourceRoot];
    // eslint-disable-next-line no-await-in-loop
    const safe = await Promise.all(roots.map((root) => writable(root, file)));
    if (!safe.every(Boolean)) {
      rewritten.set(file, {
        ...outcome,
        reason: `Cannot rewrite ${file}: expected a regular file without links`,
        status: "incomplete",
      });
      continue;
    }
    // The update command receives only opted-in shipped definitions.
    // eslint-disable-next-line no-await-in-loop
    const result = await exec(
      [binary, "scan", "--inline-rules", rules, "--update-all", "--", file],
      input.root
    );
    if (result.exitCode !== 0) {
      rewritten.set(file, {
        ...outcome,
        reason: `${source} update exited ${result.exitCode}: ${result.stderr.trim()}`,
        status: "incomplete",
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const [after] = await scanBatch(
      binary,
      source,
      { ...input, paths: [file] },
      folders
    );
    if (after !== undefined) {
      rewritten.set(file, {
        ...after,
        status: after.status === "passed" ? "fixed" : after.status,
      });
    }
  }
  return checked.map((outcome) => rewritten.get(outcome.path) ?? outcome);
};
