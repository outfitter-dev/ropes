import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import type { ToolTable } from "../../../../contracts/config.ts";
import { exec } from "../../../exec.ts";
import type { Wanted } from "../../../managed.ts";
import { baseline } from "./baseline.ts";
import { render } from "./render.ts";
import { findSource } from "./source.ts";
import type { Rules } from "./source.ts";
import { lookup, option } from "./stated.ts";
import type { KnownRule } from "./stated.ts";
import { translate } from "./translate.ts";
import type { Leftover, Renames, Sections } from "./translate.ts";

const COMMAND = "rumdl";

const SectionsSchema = z.record(z.string(), z.record(z.string(), z.unknown()));
const KnownSchema = z.array(
  z.object({
    aliases: z.array(z.string()),
    code: z.string(),
    name: z.string(),
  })
);

/** Runs the engine and reads the JSON it prints. Null when it did not. */
const ask = async (
  command: string,
  args: readonly string[]
): Promise<unknown> => {
  try {
    const ran = await exec([Bun.which(command) ?? command, ...args]);
    return ran.exitCode === 0 ? JSON.parse(ran.stdout) : null;
  } catch {
    return null;
  }
};

/**
 * The engine's own translation of the old rules. It reads a file, so the
 * rules are written to a temporary one, whichever form they came in.
 */
const imported = async (command: string, rules: Rules): Promise<unknown> => {
  const dir = await mkdtemp(path.join(tmpdir(), "cinch-import-"));
  try {
    const file = path.join(dir, ".markdownlint.json");
    // The engine never follows `extends`, and here it would point nowhere.
    const { extends: _parent, ...own } = rules;
    await Bun.write(file, JSON.stringify(own));
    return await ask(command, [
      "import",
      file,
      "--dry-run",
      "--format",
      "json",
    ]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

/** The option names the engine writes for one rule's table. */
const written = async (
  command: string,
  rule: string,
  table: Rules
): Promise<string[]> => {
  const sections = SectionsSchema.safeParse(
    await imported(command, { [rule]: table })
  );
  return Object.entries(sections.success ? sections.data : {})
    .filter(([name]) => name !== "global")
    .flatMap(([, section]) => Object.keys(section));
};

/**
 * The engine renames some options as it reads them. Each option it seemed to
 * drop is read again by itself, and what comes back is its new name. A key
 * the engine writes for the rule with no options at all is its own addition.
 */
const renamed = async (
  command: string,
  leftover: readonly Leftover[]
): Promise<Renames> => {
  const found = await Promise.all(
    leftover.map(async (old) => {
      const [alone, bare] = await Promise.all([
        written(command, old.rule, { [old.key]: old.value }),
        written(command, old.rule, {}),
      ]);
      const keys = alone.filter((key) => !bare.includes(key));
      return [`${old.id}.${option(old.key)}`, keys] satisfies [
        string,
        string[],
      ];
    })
  );
  return new Map(found.filter(([, keys]) => keys.length > 0));
};

/** What the old config says, in the engine's terms. */
export interface Carried {
  readonly ok: true;
  /** Root-relative, for messages. */
  readonly file: string;
  readonly known: readonly KnownRule[];
  readonly notes: readonly string[];
  /** The notes that leave nothing for a person to move over. */
  readonly settled: readonly string[];
  /** Only where the old config differs from the preset. */
  readonly sections: Sections;
  /** What the old config stated that the preset already sets. */
  readonly same: Sections;
  /** The IDs of the rules the old config switched off. */
  readonly off: readonly string[];
  /** The IDs of the rules the old config switched on by name. */
  readonly on: readonly string[];
}

type Failed = Exclude<Wanted, { readonly ok: true }>;

/**
 * Reads the config for the old Markdown linter and translates its rules.
 * Null when the repository has none. `table` is what the Cinch config states
 * for the engine, which the new config inherits beside the preset.
 */
export const gathered = async (
  root: string,
  preset: string,
  command = COMMAND,
  table: ToolTable = {}
): Promise<Carried | Failed | null> => {
  const source = await findSource(root);
  if (source.kind === "none") {
    return null;
  }
  if (source.kind === "blocked") {
    return { message: source.message, ok: false };
  }
  const [translation, catalog] = await Promise.all([
    imported(command, source.rules),
    ask(command, ["rule", "--output-format", "json"]),
  ]);
  const sections = SectionsSchema.safeParse(translation);
  const known = KnownSchema.safeParse(catalog);
  const standard = SectionsSchema.safeParse(Bun.TOML.parse(preset));
  if (!sections.success || !known.success || !standard.success) {
    return {
      message: `Cinch needs ${command} on PATH to carry over the Markdown rules in ${source.file}, and it did not run. Install it and run this again.`,
      ok: false,
      unknown: true,
    };
  }
  const input = {
    imported: sections.data,
    known: known.data,
    preset: baseline(standard.data, table, lookup(known.data)),
    rules: source.rules,
  };
  const first = translate(input);
  const result =
    first.leftover.length > 0
      ? translate({ ...input, renames: await renamed(command, first.leftover) })
      : first;
  return {
    file: source.file,
    known: known.data,
    notes: [...result.notes, ...source.notes],
    off: result.off,
    ok: true,
    on: result.on,
    same: result.same,
    sections: result.sections,
    settled: source.settled,
  };
};

/**
 * What a new config should hold below its `extends` line when the repository
 * still has a config for the old Markdown linter. Null when it has none.
 * Without this the engine stops reading the old config the moment the new
 * file exists, and the repository's own rules are lost without a word.
 */
export const carriedOver = async (
  root: string,
  preset: string,
  command = COMMAND,
  table: ToolTable = {}
): Promise<Wanted | null> => {
  const carried = await gathered(root, preset, command, table);
  return carried === null || !carried.ok
    ? carried
    : { ok: true, text: render(carried.file, carried) };
};
