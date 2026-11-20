export type Table = Readonly<Record<string, unknown>>;

export const isTable = (value: unknown): value is Table =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The engine reads a rule's name in any case, and `_` for `-` in a key. */
export const norm = (name: string): string =>
  /^md\d+$/iu.test(name)
    ? name.toUpperCase()
    : name.toLowerCase().replaceAll("_", "-");

/** The entry of `table` the engine would read as `name`. */
export const entryOf = (
  table: unknown,
  name: string
): readonly [string, unknown] | undefined =>
  isTable(table)
    ? Object.entries(table).find(([key]) => norm(key) === norm(name))
    : undefined;

/** The table with every empty table in it taken out. */
export const pruned = (table: Table): Table =>
  Object.fromEntries(
    Object.entries(table).flatMap(([key, value]): [string, unknown][] => {
      if (!isTable(value)) {
        return [[key, value]];
      }
      const inner = pruned(value);
      return Object.keys(inner).length === 0 ? [] : [[key, inner]];
    })
  );

/** `parsed` with the table at `path` replaced by `table`. */
export const withTable = (
  parsed: Table,
  path: readonly string[],
  table: Table
): Table => {
  const [first, ...rest] = path;
  if (first === undefined) {
    return table;
  }
  const inner = parsed[first];
  return {
    ...parsed,
    [first]: withTable(isTable(inner) ? inner : {}, rest, table),
  };
};

export const parsed = (text: string): Table | null => {
  try {
    const table: unknown = Bun.TOML.parse(text);
    return isTable(table) ? table : null;
  } catch {
    return null;
  }
};

/** The same settings, whatever the order and with empty tables left out. */
export const same = (one: Table, other: Table): boolean =>
  Bun.deepEquals(pruned(one), pruned(other));
