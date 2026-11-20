import type { Rules } from "./markdownlint-source.ts";
import { lookup, option, stated } from "./markdownlint-stated.ts";
import type { KnownRule, Option, Stated } from "./markdownlint-stated.ts";

export type Sections = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

/** An option of the old config that no key in the translation answers to. */
export interface Leftover extends Option {
  readonly id: string;
}

export interface Translated {
  /** What goes below the `extends` line. Empty when nothing differs. */
  readonly sections: Sections;
  /** What the old config stated that the preset already sets, by rule ID. */
  readonly same: Sections;
  /** The IDs of the rules the old config switched off. */
  readonly off: readonly string[];
  readonly notes: readonly string[];
  readonly leftover: readonly Leftover[];
}

/**
 * The engine's names for options it renames on the way in. The key is the
 * rule's ID, a dot and the old option; the value is what the engine wrote.
 */
export type Renames = ReadonlyMap<string, readonly string[]>;

const GLOBAL = "global";

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const sorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].toSorted((left, right) => left.localeCompare(right));

/** The lists of rules switched off and on, as differences from the preset. */
const globalOf = (
  imported: Sections,
  preset: Sections,
  said: Stated,
  idOf: (name: string) => string | undefined
): Record<string, unknown> => {
  const ids = (names: unknown): string[] =>
    strings(names).flatMap((name) => idOf(name) ?? []);
  const only = ids(imported[GLOBAL]?.enable);
  const presetOff = strings(preset[GLOBAL]?.disable);
  // A list of the only rules to run does not stop the ones the preset adds.
  const added = said.allowlist
    ? strings(preset[GLOBAL]?.["extend-enable"])
    : [];
  const extra = [
    ...ids(imported[GLOBAL]?.disable).filter((id) => !presetOff.includes(id)),
    ...added.filter((id) => !only.includes(id)),
  ];
  const kept = presetOff.filter((id) => !said.enabled.has(id));
  const table: Record<string, unknown> = {};
  if (kept.length < presetOff.length) {
    // A list here replaces the preset's, so it repeats what stays off.
    table.disable = sorted([...kept, ...extra]);
  } else if (extra.length > 0) {
    table["extend-disable"] = sorted(extra);
  }
  if (said.allowlist || only.length > 0) {
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
 * For each key the engine wrote for a rule, the old option it came from. An
 * option the old config stated under the engine's own name keeps that key.
 */
const sources = (
  id: string,
  wanted: ReadonlyMap<string, Option>,
  renames: Renames
): Map<string, string> => {
  const from = new Map([...wanted.keys()].map((old) => [old, old]));
  for (const old of wanted.keys()) {
    for (const name of renames.get(`${id}.${old}`) ?? []) {
      if (!from.has(option(name))) {
        from.set(option(name), old);
      }
    }
  }
  return from;
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
  readonly renames?: Renames;
}): Translated => {
  const { imported, preset, rules } = input;
  const renames: Renames = input.renames ?? new Map<string, string[]>();
  const idOf = lookup(input.known);
  const said = stated(rules, idOf);
  const sections: Record<string, Record<string, unknown>> = {};
  const global = globalOf(imported, preset, said, idOf);
  if (Object.keys(global).length > 0) {
    sections[GLOBAL] = global;
  }
  const same: Record<string, Record<string, unknown>> = {};
  const carried = new Set<string>();
  const names = Object.keys(imported).filter((name) => name !== GLOBAL);
  for (const name of sorted(names)) {
    const id = idOf(name);
    const wanted = id === undefined ? undefined : said.options.get(id);
    if (id === undefined || wanted === undefined) {
      continue;
    }
    const from = sources(id, wanted, renames);
    const kept = { ...sections[id] };
    for (const [key, value] of Object.entries(imported[name] ?? {})) {
      const old = from.get(option(key));
      if (old !== undefined) {
        carried.add(`${id}.${old}`);
        if (Bun.deepEquals(presetValue(preset, id, key), value, true)) {
          same[id] = { ...same[id], [key]: value };
        } else {
          kept[key] = value;
        }
      }
    }
    if (Object.keys(kept).length > 0) {
      sections[id] = kept;
    }
  }
  const leftover = [...said.options].flatMap(([id, keys]) =>
    [...keys]
      .filter(([key]) => !carried.has(`${id}.${key}`))
      .map(([, old]) => ({ ...old, id }))
  );
  const notes = [
    ...said.notes,
    ...leftover.map(
      (old) => `\`${old.key}\` on ${old.id} has no equivalent here.`
    ),
  ];
  const off = sorted(
    strings(imported[GLOBAL]?.disable).flatMap((name) => idOf(name) ?? [])
  );
  return { leftover, notes, off, same, sections };
};
