import type { Rules } from "./source.ts";

/** One rule the engine has, with every name it answers to. */
export interface KnownRule {
  readonly code: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

/** One option the old config set, as it was written there. */
export interface Option {
  /** The name the old config used for the rule. */
  readonly rule: string;
  readonly key: string;
  readonly value: unknown;
}

/** What the old config said about each rule, under the rule's ID. */
export interface Stated {
  /** True when the old config switched every rule off and named the ones on. */
  readonly allowlist: boolean;
  readonly enabled: ReadonlySet<string>;
  /** By rule ID, then by the option's name in the engine's spelling. */
  readonly options: ReadonlyMap<string, ReadonlyMap<string, Option>>;
  readonly notes: readonly string[];
}

/** Keys of the old config that are not rules. */
const SILENT = new Set(["$schema", "default", "extends"]);

/** An option's name as the engine spells it. */
export const option = (key: string): string =>
  key.toLowerCase().replaceAll("_", "-");

export const isTable = (
  value: unknown
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const lookup = (known: readonly KnownRule[]) => {
  const ids = new Map<string, string>();
  for (const rule of known) {
    for (const name of [rule.code, rule.name, ...rule.aliases]) {
      ids.set(name.toLowerCase(), rule.code);
    }
  }
  return (name: string): string | undefined => ids.get(name.toLowerCase());
};

const stranger = (key: string, value: unknown): string[] => {
  if (key === "extends" && typeof value === "string") {
    return [`\`extends\` names another config, ${value}, which was not read.`];
  }
  return SILENT.has(key)
    ? []
    : [
        `\`${key}\` is not a rule the new linter has. It may be a custom rule or a tag.`,
      ];
};

/**
 * Reads the old config in the order it was written. A rule can appear under
 * more than one name, and the last entry for it is the one that counts, as
 * it is for the old linter.
 */
export const stated = (
  rules: Rules,
  idOf: (name: string) => string | undefined
): Stated => {
  const enabled = new Set<string>();
  const options = new Map<string, Map<string, Option>>();
  const notes: string[] = [];
  for (const [rule, value] of Object.entries(rules)) {
    const id = idOf(rule);
    if (id === undefined) {
      notes.push(...stranger(rule, value));
      continue;
    }
    enabled.delete(id);
    options.delete(id);
    if (value !== false) {
      enabled.add(id);
      const entries = isTable(value) ? Object.entries(value) : [];
      options.set(
        id,
        new Map(
          entries.map(([key, set]) => [option(key), { key, rule, value: set }])
        )
      );
    }
  }
  return { allowlist: rules.default === false, enabled, notes, options };
};
