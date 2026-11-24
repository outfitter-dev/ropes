import { entryOf, isTable, norm } from "./tables.ts";
import type { Table } from "./tables.ts";

/** What becomes of each setting in a config a person wrote. */
export interface Sorted {
  /** The settings to move, as the file states them. */
  readonly carried: Table;
  /** Each setting left out, as `unitOf` names it. */
  readonly units: ReadonlySet<string>;
  /** The same settings, as a person reads them. */
  readonly dropped: readonly string[];
  /** Why the move cannot go ahead. Empty when it can. */
  readonly reasons: readonly string[];
}

/** A setting's name: its table and key, or its key alone at the top. */
export const unitOf = (...names: readonly string[]): string =>
  names.map(norm).join("\u0000");

export interface Places {
  /** The config the settings come from. */
  readonly from: string;
  /** The table they go to, as a person reads it. */
  readonly table: string;
  /** The file that table is in. */
  readonly file: string;
}

type Entry = readonly [string, unknown] | undefined;

/**
 * Sorts each setting of `own` by the layers below it. A setting moves down
 * one layer, to where `existing` already is, so a setting the two both state
 * can only stay if they agree. One that only repeats the standard is left
 * out, and so the repository follows the standard when it changes.
 */
export const sort = (
  own: Table,
  layers: { readonly existing: Table; readonly standard: Table },
  places: Places
): Sorted => {
  const { existing, standard } = layers;
  const carried: Record<string, unknown> = {};
  const units = new Set<string>();
  const dropped: string[] = [];
  const reasons: string[] = [];
  const carries = (
    names: readonly string[],
    value: unknown,
    below: { readonly theirs: Entry; readonly shipped: Entry }
  ): boolean => {
    const label = names.join(".");
    const { shipped, theirs } = below;
    if (theirs !== undefined && !Bun.deepEquals(theirs[1], value)) {
      reasons.push(
        `\`${label}\` is set in ${places.from} and in ${places.table} in ${places.file}, to different values. Remove one of the two, then run this again.`
      );
      return false;
    }
    const repeats = theirs ?? shipped;
    if (repeats === undefined || !Bun.deepEquals(repeats[1], value)) {
      return true;
    }
    units.add(unitOf(...names));
    dropped.push(label);
    return false;
  };
  for (const [section, value] of Object.entries(own)) {
    const theirs = entryOf(existing, section);
    const shipped = entryOf(standard, section);
    if (isTable(value)) {
      const kept = Object.entries(value).filter(([key, inner]) =>
        carries([section, key], inner, {
          shipped: entryOf(shipped?.[1], key),
          theirs: entryOf(theirs?.[1], key),
        })
      );
      if (kept.length > 0 && theirs !== undefined) {
        const keys = kept.map(([key]) => `\`${key}\``).join(", ");
        reasons.push(
          `${places.file} already has a \`${section}\` table under ${places.table}. Move ${keys} from \`[${section}]\` in ${places.from} into it by hand, then run this again.`
        );
      } else if (kept.length > 0) {
        carried[section] = Object.fromEntries(kept);
      }
    } else if (carries([section], value, { shipped, theirs })) {
      carried[section] = value;
    }
  }
  return { carried, dropped, reasons, units };
};
