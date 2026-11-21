import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CleanupReport, CleanupRequest } from "../contracts/cleanup.ts";
import { compareCleanup } from "../policy/cleanup.ts";
import { compileGlobs } from "../policy/glob.ts";
import { cleanupInputs } from "./cleanup/inputs.ts";
import { scanCleanup } from "./cleanup/scan.ts";
import type { Operation } from "./command.ts";
import { evaluationAt } from "./evaluation.ts";
import type { CommandDeps } from "./prepare.ts";

/** Compare full immutable source snapshots under an explicitly approved policy. */
export const runCleanup = async (
  request: CleanupRequest,
  deps: CommandDeps,
  execute: boolean
): Promise<Operation<CleanupReport>> => {
  let temporary: string | undefined;
  try {
    const evaluation = evaluationAt(request.at);
    if (!evaluation.ok) {
      return evaluation;
    }
    const { policy, trees } = await cleanupInputs(request);
    const matches = compileGlobs(policy.scope);
    const anchorHasScope = trees
      .find(({ name }) => name === "anchor")
      ?.entries.some(({ file }) => matches(file));
    if (anchorHasScope !== true) {
      throw new Error(
        "The accepted scope names no compiler configs at its anchor."
      );
    }
    temporary = await realpath(
      await mkdtemp(path.join(tmpdir(), "ropes-cleanup-"))
    );
    const directory = temporary;
    const attempted = await Promise.allSettled(
      trees.map(async (tree) => ({
        name: tree.name,
        scan: await scanCleanup(
          tree,
          {
            at: evaluation.value.at,
            cwd: request.cwd,
            destination: path.join(directory, tree.name),
            execute,
            simulated: evaluation.value.simulated,
          },
          policy,
          deps
        ),
      }))
    );
    const scans = attempted.map((attempt) => {
      if (attempt.status === "rejected") {
        throw attempt.reason;
      }
      return attempt.value;
    });
    const anchor = scans.find(({ name }) => name === "anchor")?.scan;
    const parent = scans.find(({ name }) => name === "parent")?.scan;
    const candidate = scans.find(({ name }) => name === "candidate")?.scan;
    if (
      anchor === undefined ||
      parent === undefined ||
      candidate === undefined
    ) {
      throw new Error("A required comparison snapshot is missing.");
    }
    const uncertainty = scans.flatMap(({ name, scan }) =>
      scan.result?.outcome === "incomplete"
        ? [`${name} has incomplete required checks.`]
        : []
    );
    return {
      ok: true,
      value: compareCleanup(
        { anchor, candidate, parent },
        policy,
        evaluation.value.at,
        evaluation.value.simulated,
        uncertainty,
        scans
          .filter(({ name }) => name.startsWith("history-"))
          .map(({ scan }) => scan)
      ),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  } finally {
    if (temporary !== undefined) {
      await rm(temporary, { force: true, recursive: true });
    }
  }
};
