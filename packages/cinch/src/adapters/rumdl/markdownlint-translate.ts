import type { Rules } from "./markdownlint-source.ts";

/** One rule the engine has, with every name it answers to. */
export interface KnownRule {
  readonly code: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export type Sections = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

export interface Translated {
  /** What goes below the `extends` line. Empty when nothing differs. */
  readonly sections: Sections;
  readonly notes: readonly string[];
}

const GLOBAL = "global";
/** Keys of the old config that are not rules. */
const SILENT = new Set(["$schema", "default", "extends"]);

const option = (key: string): string => key.toLowerCase().replaceAll("_", "-");

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const isTable = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const lookup = (known: readonly KnownRule[]) => {
  const ids = new Map<string, string>();
  for (const rule of known) {
    for (const name of [rule.code, rule.name, ...rule.aliases]) {
      ids.set(name.toLowerCase(), rule.code);
    }
  }
  return (name: string): string | undefined => ids.get(name.toLowerCase());
};

const sorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].toSorted((left, right) => left.localeCompare(right));

/** What the old config said about each rule, under the rule's ID. */
const stated = (rules: Rules, idOf: (name: string) => string | undefined) => {
  const enabled = new Set<string>();
  const options = new Map<string, Map<string, string>>();
  const notes: string[] = [];
  for (const [key, value] of Object.entries(rules)) {
    const id = idOf(key);
    if (id === undefined) {
      if (key === "extends" && typeof value === "string") {
        notes.push(
          `\`extends\` names another config, ${value}, which was not read.`
        );
      } else if (!SILENT.has(key)) {
        notes.push(
          `\`${key}\` is not a rule the new linter has. It may be a custom rule or a tag.`
        );
      }
    } else if (value !== false) {
      enabled.add(id);
      const keys = options.get(id) ?? new Map<string, string>();
      for (const name of isTable(value) ? Object.keys(value) : []) {
        keys.set(option(name), name);
      }
      options.set(id, keys);
    }
  }
  return { enabled, notes, options };
};

/** The lists of rules switched off and on, as differences from the preset. */
const globalOf = (
  imported: Sections,
  preset: Sections,
  enabled: ReadonlySet<string>,
  idOf: (name: string) => string | undefined
): Record<string, unknown> => {
  const ids = (names: unknown): string[] =>
    strings(names).flatMap((name) => idOf(name) ?? []);
  const off = ids(imported[GLOBAL]?.disable);
  const only = ids(imported[GLOBAL]?.enable);
  const presetOff = strings(preset[GLOBAL]?.disable);
  const extra = off.filter((id) => !presetOff.includes(id));
  const kept = presetOff.filter((id) => !enabled.has(id));
  const table: Record<string, unknown> = {};
  if (kept.length < presetOff.length) {
    // A list here replaces the preset's, so it repeats what stays off.
    table.disable = sorted([...kept, ...extra]);
  } else if (extra.length > 0) {
    table["extend-disable"] = sorted(extra);
  }
  if (only.length > 0) {
    table.enable = sorted(only);
  }
  return table;
};

const presetValue = (preset: Sections, id: string, key: string): unknown => {
  const found = Object.entries(preset[id] ?? {}).find(
    ([name]) => option(name) === option(key)
  );
  return found?.[1];
};

/**
 * Turns the engine's own translation of an old config into what this
 * repository's config needs to say. A value the engine added by itself and a
 * value the preset already sets are left out, so what remains is only where
 * the repository differs from the standard. Rule names are compared by ID, so
 * a rule switched off under an alias matches the preset's entry for it.
 */
export const translate = (input: {
  readonly rules: Rules;
  readonly imported: Sections;
  readonly known: readonly KnownRule[];
  readonly preset: Sections;
}): Translated => {
  const { imported, preset, rules } = input;
  const idOf = lookup(input.known);
  const { enabled, notes, options } = stated(rules, idOf);
  const sections: Record<string, Record<string, unknown>> = {};
  const global = globalOf(imported, preset, enabled, idOf);
  if (Object.keys(global).length > 0) {
    sections[GLOBAL] = global;
  }
  const carried = new Set<string>();
  const names = Object.keys(imported).filter((name) => name !== GLOBAL);
  for (const name of sorted(names)) {
    const id = idOf(name);
    const wanted = id === undefined ? undefined : options.get(id);
    if (id === undefined || wanted === undefined) {
      continue;
    }
    const kept = { ...sections[id] };
    for (const [key, value] of Object.entries(imported[name] ?? {})) {
      if (wanted.has(option(key))) {
        carried.add(`${id}.${option(key)}`);
        if (!Bun.deepEquals(presetValue(preset, id, key), value, true)) {
          kept[key] = value;
        }
      }
    }
    if (Object.keys(kept).length > 0) {
      sections[id] = kept;
    }
  }
  for (const [id, keys] of options) {
    for (const [key, original] of keys) {
      if (!carried.has(`${id}.${key}`)) {
        notes.push(`\`${original}\` on ${id} has no equivalent here.`);
      }
    }
  }
  return { notes, sections };
};
