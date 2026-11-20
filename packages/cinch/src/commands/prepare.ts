import type { Adapter } from "../adapters/adapter.ts";
import { readPins } from "../adapters/pins.ts";
import type { Pins, PinsResult } from "../adapters/pins.ts";
import { loadConfig } from "../config/load.ts";
import { discoverRoot, toRootRelative } from "../config/root.ts";
import type { ToolTables } from "../contracts/config.ts";
import type { Plan } from "../contracts/plan.ts";
import type { RepoRoot } from "../contracts/root.ts";
import { resolvePlan } from "../policy/resolve.ts";
import { describeConfigError, describeRootError } from "./errors.ts";
import { packagesAbove } from "./packages.ts";
import { select } from "./select.ts";
import { unreadTable } from "./tool-tables.ts";

/** What a command needs from outside. Tests pass adapters of their own. */
export interface CommandDeps {
  readonly adapters: (pins: Pins, tables?: ToolTables) => readonly Adapter[];
}

export interface Prepared {
  readonly adapters: readonly Adapter[];
  readonly plan: Plan;
  readonly root: RepoRoot;
}

export type PrepareResult =
  | { readonly ok: true; readonly value: Prepared }
  | { readonly ok: false; readonly error: string };

/** The pins nearest the root: its own `mise.toml`, else the repository's. */
const pinsFor = async (root: RepoRoot): Promise<PinsResult> => {
  const near = await readPins(root.root);
  const settled =
    !near.ok || Object.keys(near.pins).length > 0 || root.vcsRoot === root.root;
  return settled ? near : await readPins(root.vcsRoot);
};

/**
 * Everything `explain`, `check` and `fix` share: find the root, load the
 * config and the pins, expand the selection and resolve the plan. All three
 * verbs get their plan here, so none can run what another would not show.
 */
export const prepare = async (
  request: { readonly cwd: string; readonly paths: readonly string[] },
  deps: CommandDeps
): Promise<PrepareResult> => {
  const found = await discoverRoot(request.cwd);
  if (!found.ok) {
    return { error: describeRootError(found.error), ok: false };
  }
  const root = found.value;
  const [config, pins] = await Promise.all([
    loadConfig(root.root),
    pinsFor(root),
  ]);
  if (!config.ok) {
    return { error: describeConfigError(config.error), ok: false };
  }
  if (!pins.ok) {
    return { error: pins.message, ok: false };
  }
  const adapters = deps.adapters(pins.pins, config.value.tools);
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
  const packages = await packagesAbove(root.root, all);
  const resolve = (paths: readonly string[]): Plan =>
    resolvePlan({
      config: config.value,
      descriptors: adapters.map((adapter) => adapter.descriptor),
      packages,
      paths,
      root: root.root,
      selection,
    });
  const unread = unreadTable(config.value, adapters, resolve);
  if (unread !== null) {
    return { error: unread, ok: false };
  }
  // A file the caller named stays in the plan even when the config leaves it
  // out, so `explain` can say why. A file that only turned up while expanding
  // a directory does not: the first pass finds those, the second drops them.
  const keep = new Set(named);
  const candidates = resolve(all)
    .paths.filter(
      (entry) => entry.skipped === undefined || keep.has(entry.path)
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
  const plan = resolve(candidates.filter((_, index) => inside[index] === true));
  return { ok: true, value: { adapters, plan, root } };
};
