import type { ToolTable } from "../../../../contracts/config.ts";
import { isTable, option } from "./stated.ts";
import type { Sections } from "./translate.ts";

/**
 * What the new config inherits: the standard, with what the repository
 * states in the Ropes config over it. An old value is only left out of the
 * new config when this already says the same, so a setting the repository
 * changed is not taken for one the standard still provides.
 */
export const baseline = (
  preset: Sections,
  table: ToolTable,
  idOf: (name: string) => string | undefined
): Sections => {
  const merged: Record<string, Readonly<Record<string, unknown>>> = {
    ...preset,
  };
  for (const [name, stated] of Object.entries(table)) {
    if (isTable(stated)) {
      const id = idOf(name) ?? name;
      const named = new Set(Object.keys(stated).map(option));
      const kept = Object.entries(merged[id] ?? {}).filter(
        ([key]) => !named.has(option(key))
      );
      merged[id] = { ...Object.fromEntries(kept), ...stated };
    }
  }
  return merged;
};
