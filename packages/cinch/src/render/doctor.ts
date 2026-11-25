import type { DoctorReport } from "../contracts/doctor.ts";
import { EXIT_CODE, outcomeOf } from "../contracts/result.ts";
import type { Outcome } from "../contracts/result.ts";
import { pathBlocks } from "./human.ts";
import { toolLine } from "./plan.ts";
import { renderSettings } from "./settings.ts";

/**
 * A tool that cannot run leaves the setup unproven, so incomplete wins. The
 * rest is read from the steps, as the exit code of every other verb is.
 */
export const doctorOutcome = (report: DoctorReport): Outcome =>
  report.tools.some((tool) => tool.problem !== undefined)
    ? "incomplete"
    : outcomeOf([...report.result.steps, ...(report.settings?.steps ?? [])]);

const verdict = (report: DoctorReport, command: "cinch" | "rope"): string => {
  const product = command === "rope" ? "Ropes" : "Cinch";
  const repair = `\`${command} doctor --fix\``;
  const outcome = doctorOutcome(report);
  if (outcome === "clean") {
    return `The ${product} setup is in good shape.`;
  }
  if (outcome === "incomplete") {
    return "Incomplete: a file could not be judged or a tool cannot run, so this is not a pass.";
  }
  if (outcomeOf(report.settings?.steps ?? []) === "findings") {
    return `Shared settings disagree. Update the authored settings behind the reported values. For a generated file, edit the tool's settings in the Ropes config and run ${repair}.`;
  }
  return report.fix && !report.dryRun
    ? `Findings remain that ${repair} cannot repair. They need a person.`
    : `The ${product} setup needs repair. Run ${repair}.`;
};

const written = (report: DoctorReport): string[] => {
  if (!report.fix) {
    return [];
  }
  const { changed, diff, dryRun } = report;
  if (dryRun) {
    const note = `Dry run: ${changed.length} ${changed.length === 1 ? "file" : "files"} would change. Nothing was written.`;
    return diff === "" ? [note] : [diff.trimEnd(), note];
  }
  return changed.length === 0
    ? ["No files changed."]
    : [["Changed:", ...changed.map((path) => `  ${path}`)].join("\n")];
};

const packs = (
  { notAdopted }: DoctorReport,
  command: "cinch" | "rope"
): string[] =>
  notAdopted.length === 0
    ? []
    : [
        [
          "Rule packs not adopted",
          ...notAdopted.map((name) => `  ${name}`),
          `Run \`${command} rules adopt\` to see the change, and add \`--yes\` to write it.`,
        ].join("\n"),
      ];

/** Text for a person: what was written, what is still wrong, and the tools. */
export const renderDoctor = (
  report: DoctorReport,
  command: "cinch" | "rope" = "cinch"
): string =>
  [
    ...written(report),
    ...pathBlocks(report.result),
    ...(report.settings === undefined
      ? []
      : [
          renderSettings(report.settings),
          ...pathBlocks({ ...report.result, steps: report.settings.steps }),
        ]),
    ...(report.tools.length === 0
      ? []
      : [["Tools", ...report.tools.map(toolLine)].join("\n")]),
    ...packs(report, command),
    `${verdict(report, command)} Exit code ${EXIT_CODE[doctorOutcome(report)]}.`,
  ].join("\n\n");

/** The whole report, and nothing else, so stdout stays machine-readable. */
export const renderDoctorJson = (report: DoctorReport): string =>
  JSON.stringify(report, null, 2);
