import type { PackState, Plan, Provenance } from "../contracts/plan.ts";
import type {
  RulesAdoptReport,
  RulesReport,
} from "../contracts/rules-report.ts";

const origin = (source: Provenance): string =>
  source.kind === "default" ? "default" : `${source.file}: ${source.key}`;

const stateOf = (
  pack: PackState & { readonly state?: string },
  enabled: boolean,
  command: string
): string => {
  if (pack.off !== undefined) {
    return `off (${origin(pack.off)})`;
  }
  if (pack.found === undefined) {
    return `not relevant: no file matches ${pack.relevant.join(", ")}`;
  }
  if (pack.named === undefined) {
    return `not adopted, and ${pack.found} is here. Run \`${command} rules adopt ${pack.name}\` to run it`;
  }
  if (pack.state === "not-enabled" && enabled) {
    return "not enabled on its selected files";
  }
  return `${enabled ? "on" : "would run"}, since ${pack.found} is here (${origin(pack.named)})`;
};

const packLines = (
  pack: PackState,
  enabled: boolean,
  command: string
): string[] => {
  const runs =
    pack.off === undefined &&
    pack.found !== undefined &&
    pack.named !== undefined;
  return [
    `  ${pack.name}  ${stateOf(pack, enabled, command)}`,
    `    ${pack.about}`,
    ...pack.rules.map((rule) => {
      const off = rule.off === undefined ? "" : `  off (${origin(rule.off)})`;
      return `    ${rule.id}${runs ? off : ""}`;
    }),
  ];
};

/** The rule packs the plan's adapters ship, and why each runs or does not. */
export const rulesBlock = (
  packs: readonly PackState[],
  enabled = true,
  command = "cinch"
): string =>
  [
    "Rule packs",
    ...packs.flatMap((pack) => packLines(pack, enabled, command)),
  ].join("\n");

/** The folders of its own rules the repository names. */
export const localRulesBlock = (
  local: NonNullable<Plan["localRules"]>
): string =>
  [
    "Local rules",
    ...local.map(({ folder, source }) => `  ${folder}  (${origin(source)})`),
  ].join("\n");

/** What `rope rules` prints: every pack Ropes ships and how it stands here. */
export const renderRules = (
  report: RulesReport,
  config: { readonly file: string; readonly table: string },
  command: "cinch" | "rope" = "cinch"
): string =>
  [
    ...(report.enabled
      ? []
      : [
          `Rules are not switched on here, so none of these run. Set \`enabled = true\` under \`[${config.table}]\` in ${config.file} to run them.`,
        ]),
    report.packs.length === 0
      ? `${command === "rope" ? "Ropes" : "Cinch"} ships no rule pack.`
      : rulesBlock(report.packs, report.enabled, command),
    ...(report.localRules === undefined
      ? []
      : [localRulesBlock(report.localRules)]),
    ...report.notes,
  ].join("\n\n");

/** What `rope rules adopt` prints: the packs, the change, and what to know. */
export const renderAdopt = (report: RulesAdoptReport): string => {
  const { adopted, changed, diff, notes, stopped, written } = report;
  if (stopped !== undefined) {
    return [
      "No rule pack was adopted:",
      ...stopped.map((one) => `  ${one}`),
    ].join("\n");
  }
  if (adopted.length === 0) {
    return ["There is no rule pack to adopt.", ...notes].join("\n\n");
  }
  const packs = adopted.map((name) => `  ${name}`);
  return [
    [written ? "Adopted:" : "Would adopt:", ...packs].join("\n"),
    ...(written ? [`Changed:\n  ${changed.join("\n  ")}`] : [diff.trimEnd()]),
    ...notes,
    ...(written
      ? []
      : [
          "Nothing was written. Run the same command with `--yes` to write it.",
        ]),
  ].join("\n\n");
};
