import type { SettingsReport } from "../contracts/doctor.ts";
import type { Fact } from "../contracts/facts.ts";

const valueLine = (fact: Fact): string => {
  const scope = fact.path === undefined ? "" : ` for ${fact.path}`;
  const evidence = fact.evidence === undefined ? "" : `, ${fact.evidence}`;
  return `    ${fact.name} = ${JSON.stringify(fact.value)}${scope} (${fact.file}: ${fact.key}${evidence})`;
};

/** Keep observed values and limits visible even when there is no drift. */
export const renderSettings = (settings: SettingsReport): string =>
  [
    "Shared settings",
    ...settings.stated.map((fact) => `  policy\n${valueLine(fact)}`),
    ...settings.observations.flatMap((observation) => [
      `  ${observation.tool} [${observation.adapter}]`,
      ...observation.facts.map(valueLine),
      ...(observation.problem === undefined
        ? []
        : [`    incomplete: ${observation.problem}`]),
      ...observation.limitations.map((limit) => `    limit: ${limit}`),
    ]),
  ].join("\n");
