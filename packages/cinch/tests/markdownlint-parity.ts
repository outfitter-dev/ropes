import { devNull } from "node:os";

import { z } from "zod";

import { exec } from "../src/adapters/exec.ts";
import { rumdlAdapter } from "../src/adapters/rumdl/adapter.ts";
import type { KnownRule } from "../src/adapters/rumdl/migrate/markdownlint/stated.ts";
import { lookup } from "../src/adapters/rumdl/migrate/markdownlint/stated.ts";

const LegacyOutput = z.array(
  z.object({
    fileName: z.string().min(1),
    lineNumber: z.number().int().positive(),
    ruleNames: z.array(z.string().min(1)).min(1),
  })
);

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

const parseLegacy = (output: string) =>
  LegacyOutput.parse(output.trim() === "" ? [] : JSON.parse(output));

const readLegacy = async (
  command: string,
  root: string,
  config: string,
  paths: readonly string[],
  identify: (rule: string) => string
): Promise<Occurrence[]> => {
  // Both engines get the same explicit files. The legacy ignore file would
  // otherwise let markdownlint silently drop a file from that selection.
  const { exitCode, stdout, stderr } = await exec(
    [
      command,
      "--config",
      config,
      "--ignore-path",
      devNull,
      "--json",
      "--",
      ...paths,
    ],
    root
  );
  if ((exitCode !== 0 && exitCode !== 1) || stdout.trim() !== "") {
    throw new Error(`markdownlint failed (exit ${exitCode}): ${stderr.trim()}`);
  }
  const findings = parseLegacy(stderr);
  if (exitCode === 1 && findings.length === 0) {
    throw new Error("markdownlint exited 1 without findings");
  }
  const selected = new Set(paths);
  return findings.map(({ fileName, lineNumber, ruleNames }) => {
    if (!selected.has(fileName)) {
      throw new Error(`markdownlint reported on unselected file ${fileName}`);
    }
    return {
      line: lineNumber,
      path: fileName,
      rule:
        ruleNames.map(identify).find((rule) => /^MD\d+$/u.test(rule)) ??
        ruleNames.join("/"),
    };
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
  readonly legacyConfig: string;
  readonly knownRules: readonly KnownRule[];
  readonly paths: readonly string[];
  readonly legacyCommand?: string;
}): Promise<Report> => {
  const { root, knownRules, paths } = input;
  const command = Bun.which(input.legacyCommand ?? "markdownlint");
  if (command === null) {
    return { reason: "markdownlint is not on PATH", status: "incomplete" };
  }
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
    const legacy = await readLegacy(
      command,
      root,
      input.legacyConfig,
      paths,
      identify
    );
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
