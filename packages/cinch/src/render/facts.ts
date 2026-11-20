import type { Fact, FactReporter, SharedFacts } from "../contracts/facts.ts";

const statedLine = (fact: Fact): string =>
  `    ${fact.name} = ${String(fact.value)}  (${fact.file}: ${fact.key})`;

const reporterLine = (reporter: FactReporter): string =>
  reporter.reports.length === 0
    ? `    ${reporter.adapter}  cannot report what ${reporter.tool} resolves, so its settings are not compared`
    : `    ${reporter.adapter}  reports ${reporter.reports.join(", ")}`;

/**
 * What `check` compares besides the files: the facts the Cinch config
 * states, and the adapters asked what their tools resolve for them.
 */
export const factsBlock = (shared: SharedFacts): string =>
  [
    "Shared facts",
    ...(shared.stated.length === 0
      ? [
          "  the Cinch config states none, so tools are compared with each other",
        ]
      : ["  stated", ...shared.stated.map(statedLine)]),
    "  compared with",
    ...shared.reporters.map(reporterLine),
  ].join("\n");
