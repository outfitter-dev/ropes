import type { Adapter } from "../adapters/adapter.ts";
import type { Fact, FactReporter, SharedFacts } from "../contracts/facts.ts";
import type { Finding } from "../contracts/finding.ts";
import type { StepResult } from "../contracts/result.ts";
import { threw } from "./ready.ts";

/** The path a step about the whole workspace is reported under. */
const WORKSPACE = ".";

export const DRIFT_RULE = "shared-fact";

/** A statement of a fact, and the adapter that reported it, if one did. */
interface Statement {
  readonly adapter?: string;
  readonly fact: Fact;
}

const where = ({ file, key, value }: Fact): string =>
  `${file} sets \`${key}\` to ${JSON.stringify(value)}`;

const driftFinding = (adapter: string, fact: Fact, against: Fact): Finding => ({
  fixable: false,
  message: `${where(fact)}, but ${where(against)}. Both state ${fact.name}, so they have to agree. Change one of them.`,
  path: fact.file,
  range: { start: { column: 1, line: 1 } },
  rule: `${DRIFT_RULE}/${fact.name}`,
  severity: "error",
  source: adapter,
});

/**
 * One finding for each reported value that differs from the first statement
 * of the same fact. The Cinch config's statement comes first when it makes
 * one, and otherwise the adapters are held to each other. It knows a fact
 * by its name only.
 */
export const driftOf = (
  stated: readonly Fact[],
  reported: readonly Required<Statement>[]
): Finding[] => {
  const first = new Map<string, Fact>(stated.map((fact) => [fact.name, fact]));
  return reported.flatMap(({ adapter, fact }) => {
    const against = first.get(fact.name);
    if (against === undefined) {
      first.set(fact.name, fact);
      return [];
    }
    return against.value === fact.value
      ? []
      : [driftFinding(adapter, fact, against)];
  });
};

type Asked =
  | { readonly facts: readonly Required<Statement>[] }
  | { readonly step: StepResult };

const ask = async (
  reporter: FactReporter,
  adapter: Adapter | undefined,
  root: string
): Promise<Asked> => {
  const failed = (reason: string): Asked => ({
    step: {
      adapter: reporter.adapter,
      findings: [],
      path: WORKSPACE,
      reason: `could not read the settings ${reporter.tool} resolves, so they were not compared: ${reason}`,
      status: "incomplete",
    },
  });
  if (adapter?.facts === undefined) {
    return failed("the adapter does not report them");
  }
  try {
    const report = await adapter.facts(root);
    if (!report.ok) {
      return failed(report.reason);
    }
    const wanted = new Set(reporter.reports);
    return {
      facts: report.facts
        .filter((fact) => wanted.has(fact.name))
        .map((fact) => ({ adapter: reporter.adapter, fact })),
    };
  } catch (error) {
    return failed(threw(reporter.tool, error));
  }
};

/**
 * Asks each reporter the plan names what its tool resolves and compares the
 * answers. `usable` says whether an adapter's tool can run here: one that
 * cannot has already left its own steps incomplete. A difference is a
 * finding on the file that states the differing value. A reporter that
 * could not answer is incomplete, never passed.
 */
export const compareFacts = async (
  shared: SharedFacts,
  root: string,
  usable: (adapter: string) => Promise<Adapter | undefined>
): Promise<StepResult[]> => {
  const reporters = shared.reporters.filter(
    (reporter) => reporter.reports.length > 0
  );
  const asked = await Promise.all(
    reporters.map(async (reporter) => {
      const adapter = await usable(reporter.adapter);
      return adapter === undefined ? null : await ask(reporter, adapter, root);
    })
  );
  const answers = asked.filter((answer) => answer !== null);
  const findings = driftOf(
    shared.stated,
    answers.flatMap((answer) => ("facts" in answer ? answer.facts : []))
  );
  return [
    ...answers.flatMap((answer) => ("step" in answer ? [answer.step] : [])),
    ...findings.map((finding): StepResult => ({
      adapter: finding.source,
      findings: [finding],
      path: finding.path,
      status: "findings",
    })),
  ];
};
