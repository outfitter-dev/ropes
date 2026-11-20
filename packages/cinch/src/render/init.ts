import type { InitReport, Retired } from "../contracts/init.ts";
import { renderFix } from "./fix.ts";

const listed = (head: string, lines: readonly string[]): string =>
  [head, ...lines.map((line) => `  ${line}`)].join("\n");

const retiredBlocks = (retired: Retired, dryRun: boolean): string[] => {
  if (retired.files.length === 0) {
    return [];
  }
  const removal = dryRun
    ? "Old config files `cinch init --yes` will remove:"
    : "Removed old config files:";
  return [
    listed(
      retired.removed ? removal : "Old config files left in place:",
      retired.files
    ),
    ...(retired.reasons.length > 0
      ? [listed("They stay because:", retired.reasons)]
      : []),
  ];
};

/** What `init` adds below the report when it only showed the change. */
const hint = (changes: number): string =>
  changes === 0
    ? "Nothing to set up."
    : "Dry run: nothing was written. Run `cinch init --yes` to write this.";

/**
 * Text for a person: the fix report, then the old tool's config files and
 * what became of them, then what to run next when this was only a preview.
 */
export const renderInit = (report: InitReport): string => {
  const { retired } = report;
  const changes =
    report.changed.length + (retired.removed ? retired.files.length : 0);
  return [
    renderFix(report),
    ...retiredBlocks(retired, report.dryRun),
    ...(retired.leftovers.length > 0
      ? [listed("Still here, and not removed by Cinch:", retired.leftovers)]
      : []),
    ...(report.dryRun ? [hint(changes)] : []),
  ].join("\n\n");
};

/** The whole report, and nothing else, so stdout stays machine-readable. */
export const renderInitJson = (report: InitReport): string =>
  JSON.stringify(report, null, 2);
