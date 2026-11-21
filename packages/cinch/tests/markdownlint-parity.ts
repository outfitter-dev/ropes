import path from "node:path";

import { rumdlAdapter } from "../src/adapters/rumdl/adapter.ts";
import { findSource } from "../src/adapters/rumdl/migrate/markdownlint/source.ts";
import type { Rules } from "../src/adapters/rumdl/migrate/markdownlint/source.ts";
import type { KnownRule } from "../src/adapters/rumdl/migrate/markdownlint/stated.ts";
import { lookup } from "../src/adapters/rumdl/migrate/markdownlint/stated.ts";

interface Occurrence {
  readonly path: string;
  readonly line: number;
  readonly rule: string;
}

type Report =
  | {
      readonly status: "complete";
      readonly markdownlintOnly: readonly Occurrence[];
      readonly rumdlOnly: readonly Occurrence[];
    }
  | { readonly status: "incomplete"; readonly reason: string };

const readLegacy = async (
  root: string,
  rules: Rules,
  paths: readonly string[],
  identify: (rule: string) => string
): Promise<Occurrence[]> => {
  // Use the engine API to avoid merging the CLI's personal config and ignore
  // files into the rules and paths the fixture selected.
  const { lint } = await import("markdownlint/promise");
  const files = paths.map((file) => path.join(root, file));
  const results = await lint({ config: rules, files });
  return paths.flatMap((file, index) => {
    const matches = results[files[index] ?? ""];
    if (matches === undefined) {
      throw new Error(`markdownlint did not check ${file}`);
    }
    return matches.map(({ lineNumber, ruleNames }) => ({
      line: lineNumber,
      path: file,
      rule:
        ruleNames.map(identify).find((rule) => /^MD\d+$/u.test(rule)) ??
        ruleNames.join("/"),
    }));
  });
};

const key = ({ line, path: file, rule }: Occurrence): string =>
  JSON.stringify([file, line, rule]);

/** Keep repeated occurrences on a line. One matching finding consumes one. */
const difference = (
  source: readonly Occurrence[],
  other: readonly Occurrence[]
): Occurrence[] => {
  const counts = new Map<string, number>();
  for (const finding of other) {
    const id = key(finding);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return source.filter((finding) => {
    const id = key(finding);
    const count = counts.get(id) ?? 0;
    if (count === 0) {
      return true;
    }
    counts.set(id, count - 1);
    return false;
  });
};

/** Compare both engines on a trusted test fixture after running the migration. */
export const markdownlintParity = async (input: {
  readonly root: string;
  readonly knownRules: readonly KnownRule[];
  readonly paths: readonly string[];
}): Promise<Report> => {
  const { root, knownRules, paths } = input;
  if (paths.length === 0) {
    return { reason: "no Markdown files were selected", status: "incomplete" };
  }
  const adapter = rumdlAdapter();
  const idOf = lookup(knownRules);
  const identify = (rule: string) => idOf(rule) ?? rule;
  try {
    const probe = await adapter.probe();
    if (!probe.available) {
      return {
        reason: probe.reason ?? "rumdl is unavailable",
        status: "incomplete",
      };
    }
    const source = await findSource(root);
    if (source.kind === "blocked") {
      return { reason: source.message, status: "incomplete" };
    }
    if (source.kind === "none") {
      return {
        reason: "no legacy Markdown rule config was found",
        status: "incomplete",
      };
    }
    if (source.rules.extends !== undefined) {
      return {
        reason: "the fixture needs a standalone legacy rule config",
        status: "incomplete",
      };
    }
    const legacy = await readLegacy(root, source.rules, paths, identify);
    const modern = await adapter.check({ package: ".", paths, root });
    if (
      modern.length !== paths.length ||
      modern.some(
        (result, index) =>
          result.path !== paths[index] ||
          (result.status !== "passed" && result.status !== "findings")
      )
    ) {
      return {
        reason: "rumdl did not complete every selected file",
        status: "incomplete",
      };
    }
    const current = modern.flatMap(({ findings }) =>
      findings.map((finding) => ({
        line: finding.range.start.line,
        path: finding.path,
        rule: identify(finding.rule),
      }))
    );
    return {
      markdownlintOnly: difference(legacy, current),
      rumdlOnly: difference(current, legacy),
      status: "complete",
    };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : String(error),
      status: "incomplete",
    };
  }
};
