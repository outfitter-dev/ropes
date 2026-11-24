import type { PackState, Plan } from "../contracts/plan.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import type {
  RuleStanding,
  RulesPack,
  RulesReport,
} from "../contracts/rules-report.ts";
import { compileGlobs } from "../policy/glob.ts";
import { keptWhole, namedLocalRules, shippedStates } from "../policy/packs.ts";
import { renderRules } from "../render/rules.ts";
import type { Command, Operation, ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { adopt } from "./rules-adopt.ts";
import { unreached } from "./rules-reach.ts";

const standing = (pack: PackState, enabled: boolean): RuleStanding => {
  if (pack.off !== undefined) {
    return "off";
  }
  if (pack.found === undefined) {
    return "not-relevant";
  }
  if (pack.named === undefined) {
    return "not-adopted";
  }
  return enabled ? "on" : "not-enabled";
};

const withStates = (pack: PackState, enabled: boolean): RulesPack => {
  const state = standing(pack, enabled);
  return {
    ...pack,
    rules: pack.rules.map((rule) => ({
      ...rule,
      state: rule.off === undefined ? state : "off",
    })),
    state,
  };
};

const enabledInScope = (
  pack: PackState,
  plan: Plan,
  enabled: boolean,
  kept: ReadonlySet<string>
): boolean => {
  const matches = compileGlobs(pack.relevant);
  const selected = plan.paths.filter(
    (entry) =>
      !kept.has(entry.path) &&
      entry.skipped === undefined &&
      matches(entry.path)
  );
  return selected.length === 0
    ? enabled
    : selected.some((entry) =>
        entry.policy.some(
          ({ key, value }) => key === "rules.enabled" && value === true
        )
      );
};

export interface RulesListing {
  readonly report: RulesReport;
  readonly config: { readonly file: string; readonly table: string };
}

export const listRules = async (
  request: ReadRequest,
  deps: CommandDeps,
  defaultFile = "rope.toml"
): Promise<Operation<RulesListing>> => {
  const prepared = await prepare({ ...request, paths: [] }, deps);
  if (!prepared.ok) {
    return prepared;
  }
  const { adapters, config, plan, present, root } = prepared.value;
  const enabled = plan.rules !== undefined;
  const descriptors = adapters.map(({ descriptor }) => descriptor);
  const packs = plan.rules ?? shippedStates(config, descriptors, present);
  const kept = keptWhole(descriptors);
  const local = plan.localRules ?? namedLocalRules(config, descriptors);
  const file = root.configFile ?? defaultFile;
  const notes = await unreached(request, deps, {
    adapters,
    file,
    includeDisabled: defaultFile === "rope.toml",
    names: packs
      .filter((pack) => pack.named !== undefined && pack.off === undefined)
      .map((pack) => pack.name),
    present,
    root: root.root,
  });
  return {
    ok: true,
    value: {
      config: { file, table: `${config.prefix ?? ""}rules` },
      report: {
        enabled,
        ...(local === undefined ? {} : { localRules: local }),
        notes,
        packs: packs.map((pack) =>
          withStates(
            pack,
            defaultFile === "rope.toml"
              ? enabledInScope(pack, plan, enabled, kept)
              : enabled
          )
        ),
        schemaVersion: SCHEMA_VERSION,
      },
    },
  };
};

/** Lists rule packs or previews and applies explicit pack adoption. */
export const rules =
  (deps: CommandDeps): Command =>
  async (request) => {
    const action = request.action ?? "list";
    if (action === "adopt") {
      return await adopt(request, deps);
    }
    if (action !== "list") {
      return {
        error: `cinch: unknown rules action "${action}". Use list or adopt.`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const ran = await listRules(request, deps, "cinch.toml");
    if (!ran.ok) {
      return { error: `cinch: ${ran.error}`, exitCode: EXIT_CODE.incomplete };
    }
    const { report, config } = ran.value;
    return {
      exitCode: EXIT_CODE.clean,
      output: request.json
        ? JSON.stringify(report, null, 2)
        : renderRules(report, config),
    };
  };
