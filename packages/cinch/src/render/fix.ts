import type { FixReport } from "../contracts/fix.ts";
import { renderHuman } from "./human.ts";

const plural = (count: number): string =>
  `${count} ${count === 1 ? "file" : "files"}`;

const changedBlock = (report: FixReport): string[] => {
  const { changed, diff, dryRun } = report;
  if (dryRun) {
    const note = `Dry run: ${plural(changed.length)} would change. Nothing was written.`;
    return diff === "" ? [note] : [diff.trimEnd(), note];
  }
  return changed.length === 0
    ? ["No files changed."]
    : [["Changed:", ...changed.map((path) => `  ${path}`)].join("\n")];
};

/**
 * Text for a person. A dry run shows the diff. A real run names the files it
 * wrote, including when a later step could not run.
 */
export const renderFix = (report: FixReport): string =>
  [...changedBlock(report), renderHuman(report.result)].join("\n\n");

/** The whole report, and nothing else, so stdout stays machine-readable. */
export const renderFixJson = (report: FixReport): string =>
  JSON.stringify(report, null, 2);
