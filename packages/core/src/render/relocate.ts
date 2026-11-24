import type { RelocateReport } from "../contracts/relocate.ts";

const files = (title: string, paths: readonly string[]): string =>
  [title, ...paths.map((path) => `  ${path}`)].join("\n");

/** Text for a person: the files, the change, and what to know about it. */
export const renderRelocate = (
  report: RelocateReport,
  command: "cinch" | "rope" = "cinch"
): string => {
  const { action, changed, diff, notes, preset, stopped, written } = report;
  if (stopped !== undefined) {
    return [
      `Nothing was moved for the ${preset} preset:`,
      ...stopped.map((reason) => `  ${reason}`),
    ].join("\n");
  }
  if (changed.length === 0) {
    return `There is nothing to ${action} for the ${preset} preset.`;
  }
  return [
    ...(written
      ? [files("Changed:", changed)]
      : [files("Would write:", changed), diff.trimEnd()]),
    ...notes,
    ...(written
      ? []
      : [
          `Nothing was written. Run \`${command} preset ${action} ${preset} --yes\` to write it.`,
        ]),
  ].join("\n\n");
};

export const renderRelocateJson = (report: RelocateReport): string =>
  JSON.stringify(report, null, 2);
