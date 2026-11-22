import type { Adapter } from "../adapters/adapter.ts";
import type {
  Fact,
  FactObservation,
  FactReporter,
  SharedFacts,
} from "../contracts/facts.ts";
import type { Finding } from "../contracts/finding.ts";
import type { Plan, PlanBatch } from "../contracts/plan.ts";
import type { StepResult } from "../contracts/result.ts";
import type { Readiness } from "./ready.ts";
import { threw, versionProblem } from "./ready.ts";

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
 * One finding for each distinct source that differs from the first statement
 * of the same fact. The Cinch config's statement comes first when it makes
 * one, and otherwise the adapters are held to each other. It knows a fact
 * by its name only.
 */
export const driftOf = (
  stated: readonly Fact[],
  reported: readonly Required<Statement>[]
): Finding[] => {
  const first = new Map<string, Fact>(stated.map((fact) => [fact.name, fact]));
  const seen = new Set<string>();
  return reported.flatMap(({ adapter, fact }) => {
    const against = first.get(fact.name);
    if (against === undefined) {
      first.set(fact.name, fact);
      return [];
    }
    if (against.value === fact.value) {
      return [];
    }
    const finding = driftFinding(adapter, fact, against);
    const identity = JSON.stringify(finding);
    if (seen.has(identity)) {
      return [];
    }
    seen.add(identity);
    return [finding];
  });
};

const ask = async (
  reporter: FactReporter,
  adapter: Adapter | undefined,
  root: string,
  paths: readonly string[]
): Promise<FactObservation> => {
  const base = { adapter: reporter.adapter, tool: reporter.tool };
  const failed = (problem: string): FactObservation => ({
    ...base,
    facts: [],
    limitations: [],
    problem,
  });
  if (adapter?.facts === undefined) {
    return failed("the adapter does not report them");
  }
  try {
    const report = await adapter.facts(root, paths);
    if (!report.ok) {
      return failed(report.reason);
    }
    const wanted = new Set(reporter.reports);
    return {
      ...base,
      facts: report.facts.filter((fact) => wanted.has(fact.name)),
      limitations: report.limitations ?? [],
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
export const observeFacts = async (
  shared: SharedFacts,
  root: string,
  usable: (adapter: string) => Promise<Adapter | undefined>,
  batches: readonly PlanBatch[] = []
): Promise<FactObservation[]> => {
  const reporters = shared.reporters.filter(
    (reporter) => reporter.reports.length > 0
  );
  const asked = await Promise.all(
    reporters.map(async (reporter) => {
      const adapter = await usable(reporter.adapter);
      const paths = batches
        .filter((batch) => batch.adapter === reporter.adapter)
        .flatMap((batch) => batch.paths);
      return adapter === undefined
        ? null
        : await ask(reporter, adapter, root, paths);
    })
  );
  return asked.filter((answer) => answer !== null);
};

/** Reuse the same observations in checks and setup inspection. */
export const factSteps = (
  shared: SharedFacts,
  observations: readonly FactObservation[]
): StepResult[] => {
  const findings = driftOf(
    shared.stated,
    observations.flatMap(({ adapter, facts }) =>
      facts.map((fact) => ({ adapter, fact }))
    )
  );
  return [
    ...observations.flatMap((answer): StepResult[] =>
      answer.problem === undefined
        ? []
        : [
            {
              adapter: answer.adapter,
              findings: [],
              path: WORKSPACE,
              reason: `could not read the settings ${answer.tool} resolves, so they were not compared: ${answer.problem}`,
              status: "incomplete",
            },
          ]
    ),
    ...findings.map((finding): StepResult => ({
      adapter: finding.source,
      findings: [finding],
      path: finding.path,
      status: "findings",
    })),
  ];
};

/** Compare what the tools can report and retain verification limits in the run. */
export const compareFacts = async (
  plan: Plan,
  ready: (id: string) => {
    adapter: Adapter | undefined;
    probe: Promise<Readiness> | undefined;
  }
): Promise<{ notices: string[]; steps: StepResult[] }> => {
  if (plan.facts === undefined) {
    return { notices: [], steps: [] };
  }
  const observations = await observeFacts(
    plan.facts,
    plan.root,
    async (id) => {
      const { adapter, probe } = ready(id);
      const found = await probe;
      // Hold tools to the same version ranges as their file steps.
      const unfit =
        found?.problem !== undefined ||
        plan.batches.some(
          (batch) =>
            batch.adapter === id &&
            versionProblem(
              batch.tool,
              found?.version,
              batch.versionRange,
              batch.tolerates
            ) !== undefined
        );
      return unfit ? undefined : adapter;
    },
    plan.batches
  );
  return {
    notices: observations.flatMap(({ limitations, tool }) =>
      limitations.map((limit) => `${tool} settings: ${limit}`)
    ),
    steps: factSteps(plan.facts, observations),
  };
};
