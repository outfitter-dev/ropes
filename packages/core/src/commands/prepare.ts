import path from "node:path";

import type { Adapter, AdapterDescriptor } from "../adapters/adapter.ts";
import { readPins } from "../adapters/pins.ts";
import type { Pins, PinsResult } from "../adapters/pins.ts";
import { loadConfig } from "../config/load.ts";
import { managedDirFor } from "../config/managed.ts";
import { discoverRoot, toRootRelative } from "../config/root.ts";
import type { RopesConfig, ToolTables } from "../contracts/config.ts";
import type { Protected } from "../contracts/delegation.ts";
import type { EditorSettings } from "../contracts/editor.ts";
import type { InstallSettings } from "../contracts/install.ts";
import type { ManagedDir } from "../contracts/managed-config.ts";
import type { Plan } from "../contracts/plan.ts";
import type { RepoRoot } from "../contracts/root.ts";
import type { PackageTarget } from "../contracts/targets.ts";
import { unknownEnforcement } from "../policy/enforcement.ts";
import { unknownOff, unknownPacks } from "../policy/packs.ts";
import { resolvePlan } from "../policy/resolve.ts";
import type { Operation, ReadRequest } from "./command.ts";
import { validatePreparedDelegation } from "./delegates.ts";
import { describeConfigError, describeRootError } from "./errors.ts";
import { evaluationAt } from "./evaluation.ts";
import { filesUnder } from "./files.ts";
import { packagesAbove } from "./packages.ts";
import { protectedPathsAt } from "./protected-config.ts";
import { select } from "./select.ts";
import { settle } from "./settle.ts";
import { readTargets } from "./targets.ts";
import { protectedTableProblem } from "./tool-tables.ts";

/** What a command needs from outside. Tests pass adapters of their own. */
export interface CommandDeps {
  readonly adapters: (
    pins: Pins,
    tables?: ToolTables,
    editor?: EditorSettings,
    localRules?: readonly string[],
    managedDir?: ManagedDir,
    install?: InstallSettings
  ) => readonly Adapter[];
}

export interface Prepared {
  readonly protectedPaths?: ReadonlyMap<string, readonly Protected[]>;
  readonly adapters: readonly Adapter[];
  readonly config: RopesConfig;
  readonly plan: Plan;
  /** Every root-relative file the repository has, as rule packs see it. */
  readonly present: readonly string[];
  readonly root: RepoRoot;
}

export type PrepareResult = Operation<Prepared>;

/** The pins nearest the root: its own `mise.toml`, else the repository's. */
const pinsFor = async (root: RepoRoot): Promise<PinsResult> => {
  const near = await readPins(root.root);
  const settled =
    !near.ok || Object.keys(near.pins).length > 0 || root.vcsRoot === root.root;
  return settled ? near : await readPins(root.vcsRoot);
};

/** The descriptor held to its pin alone, as a strict run reads it. */
const exactly = ({
  tested: _tested,
  ...descriptor
}: AdapterDescriptor): AdapterDescriptor => descriptor;

/**
 * Everything `explain`, `check` and `fix` share: find the root, load the
 * config and the pins, expand the selection and resolve the plan. All three
 * verbs get their plan here, so none can run what another would not show.
 */
export const prepare = async (
  request: ReadRequest,
  deps: CommandDeps,
  includeSkipped = false,
  starter?: RopesConfig
): Promise<PrepareResult> => {
  const evaluation = evaluationAt(request.at);
  if (!evaluation.ok) {
    return evaluation;
  }
  const found = await discoverRoot(request.cwd);
  if (!found.ok) {
    return { error: describeRootError(found.error), ok: false };
  }
  const root = found.value;
  const [config, pins] = await Promise.all([
    loadConfig(root.root, starter),
    pinsFor(root),
  ]);
  if (!config.ok) {
    return { error: describeConfigError(config.error), ok: false };
  }
  if (!pins.ok) {
    return { error: pins.message, ok: false };
  }
  const settled = await settle(
    deps.adapters(
      pins.pins,
      config.value.tools,
      config.value.editor,
      config.value.rulesLocal?.value,
      managedDirFor(config.value.file),
      config.value.install
    ),
    root.root,
    config.value
  );
  if (!settled.ok) {
    return settled;
  }
  const { adapters } = settled;
  const owned = adapters.flatMap((adapter) => adapter.descriptor.owns ?? []);
  const selected = await select(root, request.cwd, request.paths, owned);
  if (!selected.ok) {
    return { error: selected.error, ok: false };
  }
  const { found: walked, named, selection } = selected.value;
  // A file an adapter keeps is part of the workspace before it exists, so a
  // check can report that it is missing.
  const kept = selection.kind === "workspace" ? owned : [];
  const all = [...named, ...walked, ...kept];
  const descriptors = adapters.map(({ descriptor }) => descriptor);
  const unknownLevel = unknownEnforcement(config.value, descriptors);
  if (unknownLevel !== undefined) {
    return {
      error: `${config.value.file ?? "the config"}: rules.enforcement names unknown shipped rule "${unknownLevel}".`,
      ok: false,
    };
  }
  const [unknown] = unknownOff(config.value, descriptors);
  if (unknown !== undefined) {
    const file = config.value.file ?? "the Ropes config";
    return {
      error: `${file}: rules.off: Ropes ships no rule pack or rule named "${unknown}".`,
      ok: false,
    };
  }
  const [missing] = unknownPacks(config.value, descriptors);
  if (missing !== undefined) {
    const file = config.value.file ?? "the Ropes config";
    return {
      error: `${file}: rules.packs: Ropes ships no rule pack named "${missing}".`,
      ok: false,
    };
  }
  // Which rule packs apply depends on the whole repository, whatever part
  // of it was selected.
  const shipsPacks = descriptors.some(({ packs }) => packs !== undefined);
  const everything = selection.kind === "workspace" || !shipsPacks;
  // A file named outright counts even where git ignores it. A kept file
  // can be named before it exists, and is not here until it does.
  const there = await Promise.all(
    named.map(
      async (file) =>
        !owned.includes(file) ||
        (await Bun.file(path.join(root.root, file)).exists())
    )
  );
  const present = [
    ...named.filter((_, index) => there[index] === true),
    ...(everything ? walked : await filesUnder(root, "")),
  ];
  const protectedPaths = await protectedPathsAt(root.root, config.value, [
    ...all,
    ...owned,
  ]);
  const packages = await packagesAbove(root.root, all);
  const resolve = (
    paths: readonly string[],
    targets: readonly PackageTarget[] = []
  ): Plan =>
    resolvePlan({
      config: config.value,
      descriptors: adapters.map(({ descriptor }) =>
        request.strict === true ? exactly(descriptor) : descriptor
      ),
      evaluation: evaluation.value,
      packages,
      paths,
      present,
      protectedPaths,
      root: root.root,
      selection,
      targets,
    });
  const unread = await protectedTableProblem(
    root.root,
    config.value,
    adapters,
    resolve
  );
  if (unread !== null) {
    return { error: unread, ok: false };
  }
  // A file the caller named stays in the plan even when the config leaves it
  // out, so `explain` can say why. A file that only turned up while expanding
  // a directory does not: the first pass finds those, the second drops them.
  const keep = new Set(named);
  const candidates = resolve(all)
    .paths.filter(
      (entry) =>
        includeSkipped || entry.skipped === undefined || keep.has(entry.path)
    )
    .map((entry) => entry.path);
  // Naming a path outside the root is an error. Expanding a directory must
  // not reach one either, so a symlink that leads out of the root is dropped.
  const inside = await Promise.all(
    candidates.map(async (candidate) => {
      if (keep.has(candidate)) {
        return true;
      }
      const located = await toRootRelative(root.root, root.root, candidate);
      return located.ok;
    })
  );
  const selectedPaths = candidates.filter((_, index) => inside[index] === true);
  const initialPlan = resolve(selectedPaths);
  const workspaceAdapters = new Set(
    initialPlan.batches
      .filter(({ unit }) => unit === "workspace")
      .map(({ adapter }) => adapter)
  );
  const targetRequests = new Map(
    initialPlan.paths.flatMap((entry) =>
      (entry.targets ?? []).map(({ adapter, condition }) => {
        const directory = workspaceAdapters.has(adapter) ? "." : entry.package;
        return [
          `${directory}\0${condition.dependency}`,
          { dependency: condition.dependency, package: directory },
        ] as const;
      })
    )
  );
  const plan =
    targetRequests.size === 0
      ? initialPlan
      : resolve(
          selectedPaths,
          await readTargets(root.root, [...targetRequests.values()])
        );
  return await validatePreparedDelegation({
    adapters,
    config: config.value,
    plan,
    present,
    protectedPaths,
    root,
  });
};
