import type { PackState } from "../contracts/plan.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import type {
  RuleStanding,
  RulesPack,
  RulesReport,
} from "../contracts/rules-report.ts";
import { namedLocalRules, shippedStates } from "../policy/packs.ts";
import { renderRules } from "../render/rules.ts";
import type { Command } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";

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

/**
 * `cinch rules` lists the rule packs Cinch ships and how each stands in this
 * repository, whatever part of it the command was started in. It reads the
 * same plan `explain` shows and runs nothing.
 */
export const rules =
  (deps: CommandDeps): Command =>
  async (request) => {
    const action = request.action ?? "list";
    if (action !== "list") {
      return {
        error: `cinch: unknown rules action "${action}". Use list.`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const prepared = await prepare({ ...request, paths: [] }, deps);
    if (!prepared.ok) {
      return {
        error: `cinch: ${prepared.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const { adapters, config, plan, present, root } = prepared.value;
    const enabled = plan.rules !== undefined;
    const descriptors = adapters.map(({ descriptor }) => descriptor);
    const packs = plan.rules ?? shippedStates(config, descriptors, present);
    const local = plan.localRules ?? namedLocalRules(config, descriptors);
    const report: RulesReport = {
      enabled,
      ...(local === undefined ? {} : { localRules: local }),
      packs: packs.map((pack) => withStates(pack, enabled)),
      schemaVersion: SCHEMA_VERSION,
    };
    return {
      exitCode: EXIT_CODE.clean,
      output: request.json
        ? JSON.stringify(report, null, 2)
        : renderRules(report, {
            file: root.configFile ?? "cinch.toml",
            table: `${config.prefix ?? ""}rules`,
          }),
    };
  };
