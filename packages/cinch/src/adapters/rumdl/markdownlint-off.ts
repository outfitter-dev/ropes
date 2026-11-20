const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

/**
 * A `disable` list in a config replaces the standard's. When the file being
 * adopted has one, a rule the old config switched off and the list leaves
 * out runs again, even where the old config and the standard agreed. Returns
 * a note naming those rules, or nothing when the list covers them.
 */
export const leftOn = (input: {
  /** The old config, for messages. */
  readonly file: string;
  /** The IDs of the rules the old config switched off. */
  readonly off: readonly string[];
  /** The `[global]` table of the file being adopted. */
  readonly global: Readonly<Record<string, unknown>>;
  /** What the merge adds to that table. */
  readonly added: Readonly<Record<string, unknown>>;
  readonly idOf: (name: string) => string | undefined;
}): string[] => {
  const { added, file, global, idOf } = input;
  // A `disable` the merge wanted to add is already named as a conflict.
  if (!Array.isArray(global.disable) || "disable" in added) {
    return [];
  }
  const covered = new Set(
    [global.disable, global["extend-disable"], added["extend-disable"]]
      .flatMap(strings)
      .map((name) => idOf(name) ?? name)
  );
  const missing = input.off.filter((id) => !covered.has(id));
  return missing.length > 0
    ? [
        `${file} switches off ${missing.join(", ")}, and the \`disable\` list here does not. The list here was kept, and it replaces the standard's.`,
      ]
    : [];
};
