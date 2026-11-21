import { readRepairs } from "@ropes/core";

const [directory] = process.argv.slice(2);
if (directory === undefined) {
  throw new Error("Pass the record directory.");
}
const history = await readRepairs(directory);
if (!history.ok) {
  throw new Error(history.error);
}
console.log(
  JSON.stringify(
    history.value.map((record) => ({
      authored: record.convention.authored,
      capturedAt: record.capturedAt,
      edit: record.edit,
      evidence: record.evidence,
      findings: record.result.steps.flatMap((step) => step.findings),
      id: record.id,
      originalFindings: record.original.steps.flatMap((step) => step.findings),
      outcome: record.result.outcome,
      policy: record.policy,
      scope: record.result.plan.selection,
      tools: record.tools,
    }))
  )
);
