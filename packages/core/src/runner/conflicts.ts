import path from "node:path";

import type { Adapter, FileOutcome } from "../adapters/adapter.ts";
import { CONFLICT_RULE } from "../contracts/conflict.ts";
import type { ChangeAt, Conflict } from "../contracts/conflict.ts";
import type { Finding } from "../contracts/finding.ts";
import type { PlanBatch } from "../contracts/plan.ts";
import type { StepResult } from "../contracts/result.ts";
import { answered } from "./answers.ts";
import { threw } from "./ready.ts";

/** A batch that may have written, and what it said about each file. */
export interface Settled {
  readonly batch: PlanBatch;
  readonly outcomes: readonly FileOutcome[];
}

export type Texts = ReadonlyMap<string, string | null>;

/** The text of each file. Null when it is missing or cannot be read. */
export const textsOf = async (
  root: string,
  paths: readonly string[]
): Promise<Texts> =>
  new Map(
    await Promise.all(
      paths.map(async (file): Promise<[string, string | null]> => {
        try {
          return [file, await Bun.file(path.join(root, file)).text()];
        } catch {
          return [file, null];
        }
      })
    )
  );

export interface Rewrite {
  /** The batch that just wrote. */
  readonly batch: PlanBatch;
  readonly before: Texts;
  readonly after: Texts;
  readonly root: string;
  readonly changeAt: ChangeAt;
  readonly adapterOf: (id: string) => Adapter | undefined;
}

export interface Found {
  readonly conflicts: readonly Conflict[];
  readonly steps: readonly StepResult[];
}

const keyOf = (finding: Finding): string =>
  `${finding.rule}\u0000${finding.message}`;

const countsOf = (findings: readonly Finding[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(keyOf(finding), (counts.get(keyOf(finding)) ?? 0) + 1);
  }
  return counts;
};

interface Rewritten {
  readonly finding: Finding;
  /** The rewrite of the lines the finding is on. */
  readonly diff: string;
}

/**
 * What a second look reports that the first did not, on lines the rewrite
 * changed. Lines move, so a finding is known by its rule and message: each
 * pair may have as many conflicts as it gained findings, and they are the
 * ones on changed lines, whatever order the findings come in.
 */
const fresh = (
  first: readonly Finding[],
  second: readonly Finding[],
  diffOf: (finding: Finding) => string
): Rewritten[] => {
  const before = countsOf(first);
  const gained = new Map(
    [...countsOf(second)].map(([key, count]) => [
      key,
      count - (before.get(key) ?? 0),
    ])
  );
  return second.flatMap((finding): Rewritten[] => {
    const left = gained.get(keyOf(finding)) ?? 0;
    const diff = left > 0 ? diffOf(finding) : "";
    if (diff === "") {
      return [];
    }
    gained.set(keyOf(finding), left - 1);
    return [{ diff, finding }];
  });
};

const conflictStep = (
  earlier: PlanBatch,
  later: PlanBatch,
  finding: Finding
): StepResult => ({
  adapter: earlier.adapter,
  findings: [
    {
      fixable: false,
      message: `${later.tool} rewrote this code, and ${earlier.tool} then reported ${finding.rule}: ${finding.message} The two disagree, so a fix by one is undone by the other. Change the rule or the setting behind the rewrite.`,
      path: finding.path,
      range: finding.range,
      rule: CONFLICT_RULE,
      severity: "error",
      source: earlier.adapter,
    },
  ],
  path: finding.path,
  status: "findings",
});

const again = async (
  earlier: Settled,
  paths: readonly string[],
  rewrite: Rewrite
): Promise<Found> => {
  const { adapterOf, after, batch, before, changeAt, root } = rewrite;
  const unchecked = (reason: string): Found => ({
    conflicts: [],
    steps: paths.map((file) => ({
      adapter: earlier.batch.adapter,
      findings: [],
      path: file,
      reason: `${earlier.batch.tool} could not check this file again after ${batch.tool} rewrote it: ${reason}`,
      status: "incomplete",
    })),
  });
  let second: readonly FileOutcome[] = [];
  try {
    second =
      (await adapterOf(earlier.batch.adapter)?.check({
        package: earlier.batch.package,
        paths,
        root,
        ...(earlier.batch.rules === undefined
          ? {}
          : { rules: earlier.batch.rules }),
        ...(earlier.batch.target === undefined
          ? {}
          : { target: earlier.batch.target }),
      })) ?? [];
  } catch (error) {
    return unchecked(threw(earlier.batch.tool, error));
  }
  const checked =
    earlier.batch.unit === undefined
      ? second
      : answered({ ...earlier.batch, paths }, second);
  const found = paths.map((file): Found => {
    const now = checked.find((outcome) => outcome.path === file);
    if (now === undefined || now.status === "incomplete") {
      return {
        conflicts: [],
        steps: unchecked(now?.reason ?? "it gave no answer").steps.filter(
          (step) => step.path === file
        ),
      };
    }
    const first = earlier.outcomes.find((outcome) => outcome.path === file);
    const diffOf = ({ range }: Finding): string =>
      changeAt(file, before.get(file) ?? "", after.get(file) ?? "", {
        from: range.start.line,
        to: range.end?.line ?? range.start.line,
      });
    // A rule-pack batch can report other rules while writing only eligible ones.
    const findings =
      earlier.batch.rules === undefined
        ? now.findings
        : now.findings.filter((finding) => finding.fixable);
    const conflicts = fresh(first?.findings ?? [], findings, diffOf).map(
      ({ diff, finding }): Conflict => ({
        diff,
        finding,
        path: file,
        reportedBy: earlier.batch.adapter,
        rewrittenBy: batch.adapter,
        rule: finding.rule,
      })
    );
    return {
      conflicts,
      steps: conflicts.map((conflict) =>
        conflictStep(earlier.batch, batch, conflict.finding)
      ),
    };
  });
  return {
    conflicts: found.flatMap((one) => one.conflicts),
    steps: found.flatMap((one) => one.steps),
  };
};

/**
 * After a batch wrote, checks again each file it changed with the earlier
 * steps that could write it and had answered for it. A finding that is new,
 * on lines the batch changed, is a conflict between the two steps. Nothing
 * is fixed a second time: running the two in a loop would hide it.
 */
export const conflictsAfter = async (
  settled: readonly Settled[],
  rewrite: Rewrite
): Promise<Found> => {
  const { after, batch, before } = rewrite;
  const changed = new Set(
    batch.paths.filter((file) => {
      const [old, next] = [before.get(file), after.get(file)];
      return (
        typeof old === "string" && typeof next === "string" && old !== next
      );
    })
  );
  const found = await Promise.all(
    settled
      .filter((earlier) => earlier.batch.adapter !== batch.adapter)
      .map(async (earlier): Promise<Found> => {
        const paths = earlier.outcomes
          .filter(
            (outcome) =>
              changed.has(outcome.path) && outcome.status !== "incomplete"
          )
          .map((outcome) => outcome.path);
        return paths.length === 0
          ? { conflicts: [], steps: [] }
          : await again(earlier, paths, rewrite);
      })
  );
  return {
    conflicts: found.flatMap((one) => one.conflicts),
    steps: found.flatMap((one) => one.steps),
  };
};
