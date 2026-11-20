import type { PackState, Plan, Provenance } from "../contracts/plan.ts";

const origin = (source: Provenance): string =>
  source.kind === "default" ? "default" : `${source.file}: ${source.key}`;

const stateOf = (pack: PackState): string => {
  if (pack.off !== undefined) {
    return `off (${origin(pack.off)})`;
  }
  return pack.found === undefined
    ? `not relevant: no file matches ${pack.relevant.join(", ")}`
    : `on, since ${pack.found} is here`;
};

const packLines = (pack: PackState): string[] => {
  const runs = pack.off === undefined && pack.found !== undefined;
  return [
    `  ${pack.name}  ${stateOf(pack)}`,
    `    ${pack.about}`,
    ...pack.rules.map((rule) => {
      const off = rule.off === undefined ? "" : `  off (${origin(rule.off)})`;
      return `    ${rule.id}${runs ? off : ""}`;
    }),
  ];
};

/** The rule packs the plan's adapters ship, and why each runs or does not. */
export const rulesBlock = (packs: readonly PackState[]): string =>
  ["Rule packs", ...packs.flatMap(packLines)].join("\n");

/** The folders of its own rules the repository names. */
export const localRulesBlock = (
  local: NonNullable<Plan["localRules"]>
): string =>
  [
    "Local rules",
    ...local.folders.map((folder) => `  ${folder}  (${origin(local.source)})`),
  ].join("\n");
