import type { DoctorReport } from "../contracts/doctor.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import type { Outcome } from "../contracts/result.ts";
import { pathBlocks } from "./human.ts";
import { toolLine } from "./plan.ts";

/** A tool that cannot run leaves the setup unproven, so incomplete wins. */
export const doctorOutcome = (report: DoctorReport): Outcome =>
  report.tools.some((tool) => tool.problem !== undefined)
    ? "incomplete"
    : report.result.outcome;

const verdict = (report: DoctorReport): string => {
  const outcome = doctorOutcome(report);
  if (outcome === "clean") {
    return "The Cinch setup is in good shape.";
  }
  if (outcome === "incomplete") {
    return "Incomplete: a file could not be judged or a tool cannot run, so this is not a pass.";
  }
  return report.fix && !report.dryRun
    ? "Findings remain that `cinch doctor --fix` cannot repair. They need a person."
    : "The Cinch setup needs repair. Run `cinch doctor --fix`.";
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

/** Text for a person: what was written, what is still wrong, and the tools. */
export const renderDoctor = (report: DoctorReport): string =>
  [
    ...written(report),
    ...pathBlocks(report.result),
    ...(report.tools.length === 0
      ? []
      : [["Tools", ...report.tools.map(toolLine)].join("\n")]),
    `${verdict(report)} Exit code ${EXIT_CODE[doctorOutcome(report)]}.`,
  ].join("\n\n");

/** The whole report, and nothing else, so stdout stays machine-readable. */
export const renderDoctorJson = (report: DoctorReport): string =>
  JSON.stringify(report, null, 2);
