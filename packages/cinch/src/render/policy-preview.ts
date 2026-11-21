import type { Provenance } from "../contracts/plan.ts";
import type {
  PolicyPreview,
  PreviewDecision,
} from "../contracts/policy-preview.ts";

const authored = (source: Provenance | undefined): string =>
  source?.kind === "file" ? ` · ${source.file} [${source.key}]` : "";

const decision = (value: PreviewDecision): string => {
  const target = "target" in value ? value.target?.fact : undefined;
  const deadline =
    "blockingAt" in value && value.blockingAt !== undefined
      ? ` · blocks from ${value.blockingAt}`
      : "";
  const declared =
    target?.range === undefined
      ? ""
      : ` · ${target.dependency} ${target.range} in ${target.source.file}`;
  return `${value.state} (${value.reason})${"source" in value ? authored(value.source) : ""}${"adoption" in value ? authored(value.adoption) : ""}${declared}${deadline}`;
};

const input = (label: string, source: PolicyPreview["before"]) => {
  const clock =
    source.evaluation === undefined ? "" : ` at ${source.evaluation.at}`;
  return `${label} ${source.input} · ${source.artifactVersion}${clock}`;
};

const catalogChanges = (
  before: readonly string[],
  after: readonly string[]
): string[] => {
  const added = after.filter((rule) => !before.includes(rule));
  const removed = before.filter((rule) => !after.includes(rule));
  return [
    ...(added.length === 0 ? [] : [`Rule catalog added ${added.join(", ")}`]),
    ...(removed.length === 0
      ? []
      : [`Rule catalog removed ${removed.join(", ")}`]),
  ];
};

export const renderPolicyPreview = (preview: PolicyPreview): string => {
  const { before, after, changes, incomplete } = preview;
  const selection =
    after.selection.kind === "workspace"
      ? "whole workspace"
      : after.selection.paths.join(", ") || "empty selection";
  return [
    "Policy preview (planning only). No engines ran.",
    input("Before", before),
    input("After", after),
    `Scope ${selection}`,
    ...catalogChanges(before.catalog, after.catalog),
    ...(changes.length === 0 ? ["", "No policy changes in this scope."] : []),
    ...changes.flatMap((change) => [
      "",
      `${change.path} · package ${change.package} · ${change.rule}`,
      `  Before ${decision(change.before)}`,
      `  After  ${decision(change.after)}`,
      `  Changed ${change.inputs.join(", ")}`,
    ]),
    ...(incomplete.length === 0
      ? []
      : ["", "Incomplete policy coverage", ...incomplete]),
  ].join("\n");
};
