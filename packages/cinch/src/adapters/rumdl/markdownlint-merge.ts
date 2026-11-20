import { comment, render } from "./markdownlint-render.ts";
import { lookup, option } from "./markdownlint-stated.ts";
import type { KnownRule } from "./markdownlint-stated.ts";
import type { Sections } from "./markdownlint-translate.ts";

const GLOBAL = "global";

type Table = Readonly<Record<string, unknown>>;

const isTable = (value: unknown): value is Table =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const show = (value: unknown): string => JSON.stringify(value);

/** One `key = value` line, or null for a value that needs a table. */
const line = (key: string, value: unknown): string | null => {
  const text = Bun.TOML.stringify({ [key]: value }).trim();
  return text.includes("\n") ? null : text;
};

/** The table a line opens, when it is a `[name]` header. */
const opened = (text: string): string | undefined => {
  const bare = (text.split("#")[0] ?? "").trim();
  return bare.startsWith("[") && !bare.startsWith("[[") && bare.endsWith("]")
    ? bare.slice(1, -1).trim()
    : undefined;
};

interface Plan {
  /** By the table's name in the file, the lines to put under its header. */
  readonly under: Map<string, string[]>;
  /** Tables the file does not have yet. */
  readonly fresh: Record<string, Record<string, unknown>>;
  readonly notes: string[];
  /** Every value added, to be read back from the result. */
  readonly added: (readonly [string, string, unknown])[];
}

/** The key the file already uses for an option, whatever its spelling. */
const keyIn = (table: Table, key: string): string | undefined =>
  Object.keys(table).find((name) => option(name) === option(key));

const planned = (input: {
  readonly have: Table;
  readonly file: string;
  readonly known: readonly KnownRule[];
  readonly sections: Sections;
  readonly headers: ReadonlySet<string>;
}): Plan => {
  const { file, have, headers, sections } = input;
  const idOf = lookup(input.known);
  const nameOf = (id: string): string | undefined =>
    Object.keys(have).find(
      (name) =>
        isTable(have[name]) &&
        (id === GLOBAL ? name === GLOBAL : idOf(name) === id)
    );
  const plan: Plan = { added: [], fresh: {}, notes: [], under: new Map() };
  for (const [id, wanted] of Object.entries(sections)) {
    const name = nameOf(id);
    const table = name === undefined ? undefined : have[name];
    for (const [key, value] of Object.entries(wanted)) {
      const ours =
        isTable(table) && name !== undefined ? keyIn(table, key) : undefined;
      const text = line(key, value);
      if (isTable(table) && ours !== undefined) {
        if (!Bun.deepEquals(table[ours], value, true)) {
          plan.notes.push(
            `\`${key}\` on ${id} is ${show(value)} in ${file} and ${show(table[ours])} here. The value here was kept.`
          );
        }
      } else if (name === undefined) {
        plan.fresh[id] = { ...plan.fresh[id], [key]: value };
        plan.added.push([id, key, value]);
      } else if (text !== null && headers.has(name)) {
        plan.under.set(name, [...(plan.under.get(name) ?? []), text]);
        plan.added.push([name, key, value]);
      } else {
        plan.notes.push(
          `\`${key}\` on ${id} is ${show(value)} in ${file}. Cinch could not add it to the ${name} settings here, so add it by hand.`
        );
      }
    }
  }
  return plan;
};

/** The table without one key. */
const without = (table: Table, key: string): Table =>
  Object.fromEntries(Object.entries(table).filter(([name]) => name !== key));

/**
 * True when the result still parses, holds every value that was added, and
 * is otherwise what the file said before. A line that landed somewhere other
 * than its table, such as inside a string, fails here.
 */
const holds = (text: string, before: Table, plan: Plan): boolean => {
  let after: Table = {};
  try {
    const table: unknown = Bun.TOML.parse(text);
    after = isTable(table) ? table : {};
  } catch {
    return false;
  }
  for (const [name, key, value] of plan.added) {
    const section = after[name];
    if (!isTable(section) || !Bun.deepEquals(section[key], value, true)) {
      return false;
    }
    const rest = without(section, key);
    after =
      Object.keys(rest).length === 0 && !(name in before)
        ? without(after, name)
        : { ...after, [name]: rest };
  }
  return Bun.deepEquals(after, before, true);
};

/**
 * Adds the old linter's rules to a config that is already there. A value the
 * file sets stays as it is, and a different value in the old config is named
 * in a comment. Everything else is added: under the table's own header when
 * the file has one, and as a new table at the end when it does not.
 */
export const merge = (input: {
  /** Valid TOML. */
  readonly current: string;
  /** The old config, for messages. */
  readonly file: string;
  readonly known: readonly KnownRule[];
  readonly notes: readonly string[];
  readonly sections: Sections;
}):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly message: string } => {
  const { current, file } = input;
  const parsed: unknown = Bun.TOML.parse(current);
  const lines = current.trimEnd().split("\n");
  const headers = new Set(lines.flatMap((text) => opened(text) ?? []));
  const have = isTable(parsed) ? parsed : {};
  const plan = planned({
    file,
    have,
    headers,
    known: input.known,
    sections: input.sections,
  });
  const marked = comment([`Carried over from ${file} by Cinch.`]).trimEnd();
  const kept = lines.flatMap((text) => {
    const extra = plan.under.get(opened(text) ?? "");
    return extra === undefined ? [text] : [text, marked, ...extra];
  });
  const tail = render(file, {
    notes: [...plan.notes, ...input.notes],
    sections: plan.fresh,
  });
  const text = `${kept.join("\n")}\n${tail}`;
  return holds(text, have, plan)
    ? { ok: true, text }
    : {
        message: `Cinch could not add the Markdown rules in ${file} to this file and keep it valid. Add \`extends\` and those rules by hand.`,
        ok: false,
      };
};
