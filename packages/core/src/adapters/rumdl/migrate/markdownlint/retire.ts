import path from "node:path";

import type { ToolTable } from "../../../../contracts/config.ts";
import type { Retired } from "../../../adapter.ts";
import { leftovers } from "./leftovers.ts";
import { merge } from "./merge.ts";
import { gathered } from "./rules.ts";
import { CONFIG_FILES, present } from "./source.ts";

/** What a config says it extends. Throws when the text is not TOML. */
export const extendsOf = (text: string): unknown => {
  const table: unknown = Bun.TOML.parse(text);
  return typeof table === "object" && table !== null && "extends" in table
    ? table.extends
    : undefined;
};

const read = async (file: string): Promise<string | null> => {
  const handle = Bun.file(file);
  return (await handle.exists()) ? await handle.text() : null;
};

export interface Setup {
  readonly root: string;
  /** The engine's config in this repository, root-relative. */
  readonly config: string;
  /** What that config extends once Cinch keeps it. */
  readonly extended: string;
  /** The standard's own text. */
  readonly standard: string;
  /** What the Cinch config states for the engine. */
  readonly table?: ToolTable | undefined;
  readonly command?: string;
}

/**
 * Why the old files should stay, given what is about to be written. Anything
 * that would not reach the new config is a reason, because the old file is
 * then the only place that still says it.
 */
const reasons = async (
  setup: Setup,
  files: readonly string[]
): Promise<string[]> => {
  const current = await read(path.join(setup.root, setup.config));
  let found: unknown;
  try {
    found = current === null ? undefined : extendsOf(current);
  } catch {
    // The write reports this file, and nothing is removed after a failure.
    return [];
  }
  if (found === setup.extended) {
    return [
      `${setup.config} was set up before this run, so Cinch cannot tell what was carried over from ${files.join(", ")}. Remove what is no longer wanted by hand.`,
    ];
  }
  const carried = await gathered(
    setup.root,
    setup.standard,
    setup.command,
    setup.table
  );
  if (carried === null) {
    return [];
  }
  if (!carried.ok) {
    return [carried.message];
  }
  const lost = carried.notes.filter((note) => !carried.settled.includes(note));
  if (current === null || found !== undefined) {
    return lost;
  }
  const merged = merge({ ...carried, current });
  return merged.ok ? [...merged.notes, ...lost] : [merged.message];
};

/**
 * The old Markdown linter's config files, and whether they can go. They can
 * when everything they say is in the config Cinch is about to write. What
 * else still names the old linter is reported beside them. Null when the
 * repository has neither.
 */
export const retired = async (setup: Setup): Promise<Retired | null> => {
  const [files, left] = await Promise.all([
    present(setup.root, CONFIG_FILES),
    leftovers(setup.root),
  ]);
  const needs = [setup.config];
  if (files.length === 0) {
    return left.length === 0
      ? null
      : { files, keep: [], leftovers: left, needs };
  }
  return { files, keep: await reasons(setup, files), leftovers: left, needs };
};
