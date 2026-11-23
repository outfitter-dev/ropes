type Table = Readonly<Record<string, unknown>>;

const isTable = (value: unknown): value is Table =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type NamedPacks =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

const escaped = (name: string): string =>
  name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

const HEADER = /^\s*\[/u;
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/gu;

/** How many more `[` than `]` the line has, outside its strings. */
const opens = (line: string): number => {
  const bare = line.replaceAll(QUOTED, "").replace(/#.*$/u, "");
  return bare.split("[").length - bare.split("]").length;
};

/** The index after the last line of the value that starts on `from`. */
const valueEnd = (lines: readonly string[], from: number): number => {
  let depth = 0;
  for (let at = from; at < lines.length; at += 1) {
    depth += opens(lines[at] ?? "");
    if (depth <= 0) {
      return at + 1;
    }
  }
  return lines.length;
};

const rulesOf = (text: string, names: readonly string[]): unknown => {
  let at: unknown = Bun.TOML.parse(text);
  for (const name of names) {
    at = isTable(at) ? at[name] : undefined;
  }
  return at;
};

/** The document with the two keys this edit may change taken out. */
const strip = (value: unknown, names: readonly string[]): unknown => {
  const table = isTable(value) ? value : {};
  const [head, ...tail] = names;
  if (head === undefined) {
    const { enabled: _enabled, packs: _packs, ...others } = table;
    return others;
  }
  return { ...table, [head]: strip(table[head], tail) };
};

/** Whether the edit named the packs and changed nothing else. */
const isOnlyThat = (
  before: string,
  after: string,
  names: readonly string[],
  packs: readonly string[]
): boolean => {
  try {
    const rules = rulesOf(after, names);
    return (
      isTable(rules) &&
      Bun.deepEquals(rules.packs, [...packs]) &&
      Bun.deepEquals(
        strip(Bun.TOML.parse(after), names),
        strip(Bun.TOML.parse(before), names)
      )
    );
  } catch {
    return false;
  }
};

const within = (
  lines: readonly string[],
  start: number,
  packs: string,
  enable: boolean
): string[] => {
  const next = lines.findIndex(
    (line, index) => index > start && HEADER.test(line)
  );
  const end = next === -1 ? lines.length : next;
  const key = (name: string): number =>
    lines.findIndex(
      (line, index) =>
        index > start &&
        index < end &&
        new RegExp(String.raw`^\s*${name}\s*=`, "u").test(line)
    );
  const stated = key("packs");
  const enabled = key("enabled");
  if (stated !== -1) {
    return [
      ...lines.slice(0, stated),
      ...(enabled === -1 && enable ? ["enabled = true"] : []),
      packs,
      ...lines.slice(valueEnd(lines, stated)),
    ];
  }
  const after = enabled === -1 ? start : enabled;
  return [
    ...lines.slice(0, after + 1),
    ...(enabled === -1 && enable ? ["enabled = true"] : []),
    packs,
    ...lines.slice(after + 1),
  ];
};

/**
 * The config text with `packs` under its rules table naming exactly the
 * packs given, and rules switched on where the table did not say. Every
 * other line is left as it was, line endings included. It refuses when it cannot make that edit
 * and nothing else, so a person's config is never rewritten by guesswork.
 */
export const namePacks = (
  given: string,
  prefix: string,
  packs: readonly string[],
  enable = true
): NamedPacks => {
  // The edit is made on LF text and given back with the endings it came in.
  const crlf = given.includes("\r\n");
  const text = crlf ? given.replaceAll("\r\n", "\n") : given;
  const back = (edited: string): string =>
    crlf ? edited.replaceAll("\n", "\r\n") : edited;
  const names = [...prefix.split("."), "rules"].filter((name) => name !== "");
  const title = names.join(".");
  const line = `packs = [${packs.map((name) => JSON.stringify(name)).join(", ")}]`;
  const lines = text.split("\n");
  const start = lines.findIndex((one) =>
    new RegExp(
      String.raw`^\s*\[\s*${escaped(title)}\s*\]\s*(?:#.*)?$`,
      "u"
    ).test(one)
  );
  const by = `Add \`${line}\` under \`[${title}]\` by hand.`;
  if (start === -1 && rulesOf(text, names) !== undefined) {
    return {
      ok: false,
      reason: `The rules settings are not in a \`[${title}]\` table of their own. ${by}`,
    };
  }
  const edited =
    start === -1
      ? `${text.trimEnd()}\n\n[${title}]\n${enable ? "enabled = true\n" : ""}${line}\n`
      : within(lines, start, line, enable).join("\n");
  if (crlf && back(text) !== given) {
    return {
      ok: false,
      reason: `The file mixes line endings, so Cinch will not edit it. ${by}`,
    };
  }
  const kept = isOnlyThat(text, edited, names, packs);
  return kept
    ? { ok: true, text: back(edited) }
    : { ok: false, reason: `Cinch could not make the edit safely. ${by}` };
};
