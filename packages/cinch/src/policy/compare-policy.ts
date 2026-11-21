import type {
  PolicyChange,
  PolicyPreview,
  PolicySnapshot,
  PreviewDecision,
} from "../contracts/policy-preview.ts";
import type { PackageTarget } from "../contracts/targets.ts";

type SnapshotPath = PolicySnapshot["paths"][number];

const selectionKey = (selection: PolicySnapshot["selection"]) =>
  selection.kind === "workspace"
    ? "workspace"
    : JSON.stringify([...new Set(selection.paths)].toSorted());

export const sameSelection = (
  before: PolicySnapshot,
  after: PolicySnapshot
): boolean => selectionKey(before.selection) === selectionKey(after.selection);

const otherwise = (
  catalog: ReadonlySet<string>,
  file: SnapshotPath | undefined,
  rule: string
): PreviewDecision => {
  if (file === undefined) {
    return {
      reason: "the path is absent from this snapshot",
      state: "unresolved",
    };
  }
  if (!catalog.has(rule)) {
    return { reason: "the rule is absent from this artifact", state: "absent" };
  }
  return {
    reason: "the path is outside the rule's file scope",
    state: "inapplicable",
  };
};

const keyOf = (value: unknown): string | undefined => JSON.stringify(value);

/** Hashes identify observed manifest bytes, while policy uses the declared fact. */
const targetFact = (fact: PackageTarget | undefined): string | undefined => {
  if (fact === undefined) {
    return undefined;
  }
  const {
    source: { sha256: _sourceHash, ...source },
    inheritedBy,
    ...value
  } = fact;
  const inherited =
    inheritedBy === undefined
      ? undefined
      : { file: inheritedBy.file, key: inheritedBy.key };
  return keyOf({ ...value, inheritedBy: inherited, source });
};

const policyKey = (value: PreviewDecision) => {
  if (!("target" in value) || value.target === undefined) {
    return keyOf(value);
  }
  return keyOf({
    ...value,
    target: { ...value.target, fact: targetFact(value.target.fact) },
  });
};

const targetChanges = (
  before: PreviewDecision,
  after: PreviewDecision
): string[] => {
  const inputs: string[] = [];
  const beforeTarget = "target" in before ? before.target : undefined;
  const afterTarget = "target" in after ? after.target : undefined;
  const oldFact = targetFact(beforeTarget?.fact);
  const newFact = targetFact(afterTarget?.fact);
  if (oldFact !== undefined && newFact !== undefined && oldFact !== newFact) {
    inputs.push("declared package target");
  }
  if (
    beforeTarget !== undefined &&
    afterTarget !== undefined &&
    keyOf(beforeTarget.condition) !== keyOf(afterTarget.condition)
  ) {
    inputs.push("rule applicability condition");
  }
  return inputs;
};

const changedInputs = (
  before: PreviewDecision,
  after: PreviewDecision,
  oldPackage: string | undefined,
  newPackage: string | undefined
): string[] => {
  const inputs: string[] = [];
  if (before.state === "absent" || after.state === "absent") {
    inputs.push("artifact rule catalog");
  }
  inputs.push(...targetChanges(before, after));
  const oldAdoption = "adoption" in before ? before.adoption : undefined;
  const newAdoption = "adoption" in after ? after.adoption : undefined;
  if (
    before.state !== "absent" &&
    after.state !== "absent" &&
    keyOf(oldAdoption) !== keyOf(newAdoption)
  ) {
    inputs.push("pack adoption");
  }
  const beforeTime = "blockingAt" in before ? before.blockingAt : undefined;
  const afterTime = "blockingAt" in after ? after.blockingAt : undefined;
  if (
    beforeTime !== undefined &&
    beforeTime === afterTime &&
    before.state !== after.state
  ) {
    inputs.push("evaluation time");
  }
  if (
    oldPackage !== newPackage ||
    before.state === "exempt" ||
    after.state === "exempt"
  ) {
    inputs.push("path scope or exemption");
  }
  return inputs.length === 0 ? ["effective rule policy"] : inputs;
};

const reportInput = (
  { artifactVersion, catalog, evaluation, root, selection }: PolicySnapshot,
  input: string
) => ({
  artifactVersion,
  catalog,
  evaluation,
  input,
  root,
  selection,
});

const unresolved = (
  path: string,
  rule: string,
  before: PreviewDecision,
  after: PreviewDecision
) => {
  const parts = [
    ...(before.state === "unresolved" ? [`before: ${before.reason}`] : []),
    ...(after.state === "unresolved" ? [`after: ${after.reason}`] : []),
  ];
  return parts.length === 0
    ? undefined
    : `${path} · ${rule}: ${parts.join(". ")}`;
};

const changed = (
  path: string,
  rule: string,
  before: PreviewDecision,
  after: PreviewDecision,
  oldPackage: string | undefined,
  newPackage: string | undefined
): PolicyChange | undefined =>
  policyKey(before) === policyKey(after) && oldPackage === newPackage
    ? undefined
    : {
        after,
        before,
        inputs: changedInputs(before, after, oldPackage, newPackage),
        package: newPackage ?? oldPackage ?? ".",
        path,
        rule,
      };

export const comparePolicy = (
  before: PolicySnapshot,
  after: PolicySnapshot,
  names: readonly [string, string]
): PolicyPreview => {
  const oldPaths = new Map(before.paths.map((file) => [file.path, file]));
  const newPaths = new Map(after.paths.map((file) => [file.path, file]));
  const oldCatalog = new Set(before.catalog);
  const newCatalog = new Set(after.catalog);
  const changes: PolicyChange[] = [];
  const incomplete: string[] = [];
  for (const path of [
    ...new Set([...oldPaths.keys(), ...newPaths.keys()]),
  ].toSorted()) {
    const oldFile = oldPaths.get(path);
    const newFile = newPaths.get(path);
    const oldRules = new Map(oldFile?.rules.map((rule) => [rule.rule, rule]));
    const newRules = new Map(newFile?.rules.map((rule) => [rule.rule, rule]));
    const rules = [
      ...new Set([...oldRules.keys(), ...newRules.keys()]),
    ].toSorted();
    if (
      rules.length === 0 &&
      (oldFile === undefined || newFile === undefined)
    ) {
      const missing = oldFile === undefined ? "before" : "after";
      incomplete.push(
        `${path}: the path is absent from the ${missing} snapshot`
      );
    }
    for (const rule of rules) {
      const from = oldRules.get(rule) ?? otherwise(oldCatalog, oldFile, rule);
      const to = newRules.get(rule) ?? otherwise(newCatalog, newFile, rule);
      const problem = unresolved(path, rule, from, to);
      if (problem !== undefined) {
        incomplete.push(problem);
      }
      const change = changed(
        path,
        rule,
        from,
        to,
        oldFile?.package,
        newFile?.package
      );
      if (change !== undefined) {
        changes.push(change);
      }
    }
  }
  return {
    after: reportInput(after, names[1]),
    before: reportInput(before, names[0]),
    changes,
    evidence: "planned",
    incomplete,
    schemaVersion: 1,
  };
};
