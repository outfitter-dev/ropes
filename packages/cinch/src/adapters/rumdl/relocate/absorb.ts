import path from "node:path";

import type { ToolTable } from "../../../contracts/config.ts";
import type { ConfigText, Relocation } from "../../relocation.ts";
import { generated, preset } from "../generated.ts";
import {
  CONFIG_PATH,
  GENERATED_PATH,
  PRESET_PATH,
  RUMDL_TABLE,
  standard,
} from "../paths.ts";
import { POINTER, isMarked, isPointer } from "../root-config.ts";
import { blockOf } from "./block.ts";
import { commentsIn, linesOf, sectionsOf } from "./scan.ts";
import { sort } from "./sort.ts";
import type { Sorted } from "./sort.ts";
import { parsed, same, withTable } from "./tables.ts";
import type { Table } from "./tables.ts";

const stop = (...reasons: readonly string[]): Relocation => ({
  ok: false,
  reasons,
});

/** The names of the tables down to the engine's own, in the Cinch config. */
export const familyOf = (config: ConfigText): string[] => [
  ...config.prefix.split(".").filter((name) => name !== ""),
  "tools",
  RUMDL_TABLE,
];

/**
 * The settings as text for the Cinch config. The file's own lines are used
 * when they parse to exactly the settings to carry, which keeps its
 * comments. Otherwise the settings are written out afresh.
 */
const written = (
  text: string,
  sorted: Sorted,
  family: readonly string[]
): { readonly text: string; readonly lost: readonly string[] } => {
  const all = sectionsOf(text).flatMap((section) =>
    commentsIn(linesOf(section))
  );
  if (Object.keys(sorted.carried).length === 0) {
    return { lost: all, text: "" };
  }
  const wanted = withTable({}, family, sorted.carried);
  const kept = blockOf(text, sorted.units, family.join("."));
  const read = parsed(kept.text);
  return read !== null && same(read, wanted)
    ? kept
    : { lost: all, text: Bun.TOML.stringify(wanted).trim() };
};

const notesOf = (
  dropped: readonly string[],
  lost: readonly string[]
): string[] => [
  ...(dropped.length === 0
    ? []
    : [
        `Left out, because the layer below already says the same: ${dropped.join(", ")}.`,
      ]),
  ...(lost.length === 0
    ? []
    : [
        `These comments in ${CONFIG_PATH} were not carried over:\n${lost.map((line) => `  ${line}`).join("\n")}`,
      ]),
];

/** Why the root config is not one whose settings can move, or null. */
const blocked = (current: string, own: Table | null): string | null => {
  if (isMarked(current)) {
    return `${CONFIG_PATH} says Cinch generated it, but it holds more than Cinch wrote. Delete its first comment to make the file your own, then run this again.`;
  }
  if (own === null) {
    return `${CONFIG_PATH} is not valid TOML, so Cinch cannot read its settings.`;
  }
  return own.extends === GENERATED_PATH
    ? null
    : `${CONFIG_PATH} does not extend ${GENERATED_PATH}, so moving its settings there would change what applies. Run \`cinch doctor --fix\` first.`;
};

/**
 * A setting is left out when the standard already says the same, so the
 * preset the engine reads has to be that standard. Returns why it is not.
 */
const stale = async (root: string): Promise<string | null> => {
  const file = Bun.file(path.join(root, PRESET_PATH));
  const installed = (await file.exists()) ? await file.text() : null;
  const shipped = await preset();
  return shipped.ok && installed === shipped.text
    ? null
    : `${PRESET_PATH} is not the preset this Cinch ships, so what the settings sit above is not what Cinch would compare them with. Run \`cinch doctor --fix\` first.`;
};

/**
 * Moves what the root config states into the engine's table in the Cinch
 * config, and leaves the root config a pointer. The settings go down one
 * layer and the layers keep their order, so the engine resolves the same.
 */
export const absorb = async (
  root: string,
  config: ConfigText,
  table: ToolTable = {}
): Promise<Relocation> => {
  const file = Bun.file(path.join(root, CONFIG_PATH));
  const current = (await file.exists()) ? await file.text() : null;
  if (current === null || isPointer(current)) {
    return { files: [], notes: [], ok: true };
  }
  const own = parsed(current);
  const reason = blocked(current, own) ?? (await stale(root));
  const before = parsed(config.text);
  const shipped = parsed(await standard());
  if (reason !== null || own === null || before === null || shipped === null) {
    return stop(reason ?? `Cinch could not read ${config.file}.`);
  }
  const family = familyOf(config);
  const { extends: _chain, ...settings } = own;
  const sorted = sort(
    settings,
    { existing: table, standard: shipped },
    {
      file: config.file,
      from: CONFIG_PATH,
      table: `\`[${family.join(".")}]\``,
    }
  );
  if (sorted.reasons.length > 0) {
    return stop(...sorted.reasons);
  }
  const merged = { ...table, ...sorted.carried };
  const block = written(current, sorted, family);
  const text =
    block.text === ""
      ? config.text
      : `${config.text.trimEnd()}\n\n${block.text}\n`.trimStart();
  const after = parsed(text);
  if (after === null || !same(after, withTable(before, family, merged))) {
    return stop(
      `Cinch could not add the settings to ${config.file} without changing what it already says. Move them under \`[${family.join(".")}]\` by hand.`
    );
  }
  const below = await generated(merged);
  if (!below.ok) {
    return stop(below.message);
  }
  return {
    files: [
      { path: config.file, text },
      { path: GENERATED_PATH, text: below.text },
      { path: CONFIG_PATH, text: POINTER },
    ],
    notes: notesOf(sorted.dropped, block.lost),
    ok: true,
  };
};
