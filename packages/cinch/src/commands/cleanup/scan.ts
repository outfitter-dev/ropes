import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { AdapterDescriptor } from "../../adapters/adapter.ts";
import type { CleanupPolicy, CleanupScan } from "../../contracts/cleanup.ts";
import type { Plan } from "../../contracts/plan.ts";
import { compileGlobs } from "../../policy/glob.ts";
import { runPlan } from "../../runner/run.ts";
import { prepare } from "../prepare.ts";
import type { CommandDeps } from "../prepare.ts";
import { materialize } from "./git.ts";
import type { Entry } from "./git.ts";

const validateScope = async (
  root: string,
  entries: readonly Entry[],
  policy: CleanupPolicy,
  descriptor: AdapterDescriptor,
  plan: Plan
): Promise<void> => {
  const matches = compileGlobs(policy.scope);
  const scope = descriptor.ruleScopes?.[policy.rule];
  const ignores = compileGlobs(scope?.ignores ?? []);
  const applicable = compileGlobs(scope?.files ?? ["**"]);
  const selected = entries.filter(({ file }) => matches(file));
  await Promise.all(
    selected.map(async ({ file }) => {
      if (!file.endsWith(".json")) {
        throw new Error(
          `Unsupported occurrence scope at ${file}. This migration supports compiler config files only.`
        );
      }
      if (
        ignores(file) ||
        !applicable(file) ||
        !plan.batches.some(
          (batch) =>
            batch.paths.includes(file) &&
            batch.rules?.includes(policy.rule) === true
        )
      ) {
        throw new Error(
          `${file} has incomplete migration coverage. The accepted scope must keep its adopted rule enabled.`
        );
      }
      const parsed: unknown = await Bun.file(path.join(root, file)).json();
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error(
          `${file} must be a JSON object for reliable occurrence identity.`
        );
      }
    })
  );
};

export const scanCleanup = async (
  input: {
    readonly revision: string;
    readonly tree: string;
    readonly entries: readonly Entry[];
  },
  options: {
    readonly cwd: string;
    readonly destination: string;
    readonly at: string;
    readonly execute: boolean;
    readonly simulated: boolean;
  },
  policy: CleanupPolicy,
  deps: CommandDeps
): Promise<CleanupScan> => {
  await mkdir(options.destination, { recursive: true });
  await materialize(options.cwd, input.entries, options.destination);
  const prepared = await prepare(
    { at: options.at, cwd: options.destination, paths: [], strict: true },
    deps
  );
  if (!prepared.ok) {
    throw new Error(prepared.error);
  }
  const { adapters } = prepared.value;
  const plan = {
    ...prepared.value.plan,
    ...(prepared.value.plan.evaluation === undefined
      ? {}
      : {
          evaluation: {
            ...prepared.value.plan.evaluation,
            simulated: options.simulated,
          },
        }),
  };
  const descriptor = adapters.find(
    ({ descriptor: item }) => item.ruleDigests?.[policy.rule] !== undefined
  )?.descriptor;
  if (
    descriptor?.ruleDigests?.[policy.rule] !== policy.ruleSha256 ||
    descriptor.ruleIdentities?.[policy.rule] !== "single-json-document"
  ) {
    throw new Error(
      "The migration rule digest is unknown or differs from this build. Review an explicit rule update before comparing."
    );
  }
  const required = plan.batches.filter(
    (batch) => batch.rules?.includes(policy.rule) === true
  );
  if (
    required.some(({ versionRange }) => !/^\d+\.\d+\.\d+$/u.test(versionRange))
  ) {
    throw new Error(
      "Pin the migration rule's engine to an exact version before comparing immutable scans."
    );
  }
  await validateScope(
    options.destination,
    input.entries,
    policy,
    descriptor,
    plan
  );
  const result = options.execute
    ? await runPlan(plan, adapters, { mode: "check" })
    : undefined;
  return {
    commit: input.revision,
    plan,
    ...(result === undefined ? {} : { result }),
    tree: input.tree,
  };
};
