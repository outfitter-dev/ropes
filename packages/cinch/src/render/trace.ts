import type { CheckTrace, TracedBatch } from "../contracts/trace.ts";
import { renderPlan } from "./plan.ts";

const batchBlock = ({ batch, description }: TracedBatch): string => {
  const heading = `Planned invocation for ${batch.adapter} (${batch.package})`;
  if (!description.ok) {
    return `${heading}\n  Unavailable: ${description.error}`;
  }
  const { invocations, limitations, rules, sources } = description.value;
  return [
    heading,
    ...rules.map((rule) => `  rule: ${rule}`),
    ...sources.map((source) => `  authored rule: ${source}`),
    ...invocations.flatMap(({ argv, cwd }) => [
      `  cwd: ${cwd}`,
      `  argv: ${JSON.stringify(argv)}`,
    ]),
    ...limitations.map((limitation) => `  ${limitation}`),
  ].join("\n");
};

export const renderTrace = (trace: CheckTrace): string =>
  [
    renderPlan(trace.plan, { configFile: trace.configFile, tools: [] }),
    ...trace.batches.map(batchBlock),
  ].join("\n\n");
