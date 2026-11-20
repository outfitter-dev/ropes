import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import type { Wanted } from "../managed.ts";
import { exec } from "./exec.ts";
import { findSource } from "./markdownlint-source.ts";
import type { Rules } from "./markdownlint-source.ts";
import { translate } from "./markdownlint-translate.ts";
import type { Sections, Translated } from "./markdownlint-translate.ts";

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
const ask = async (args: readonly string[]): Promise<unknown> => {
  try {
    const ran = await exec([Bun.which(COMMAND) ?? COMMAND, ...args]);
    return ran.exitCode === 0 ? JSON.parse(ran.stdout) : null;
  } catch {
    return null;
  }
};

/**
 * The engine's own translation of the old rules. It reads a file, so the
 * rules are written to a temporary one, whichever form they came in.
 */
const imported = async (rules: Rules): Promise<unknown> => {
  const dir = await mkdtemp(path.join(tmpdir(), "cinch-import-"));
  try {
    const file = path.join(dir, ".markdownlint.json");
    await Bun.write(file, JSON.stringify(rules));
    return await ask(["import", file, "--dry-run", "--format", "json"]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

const comment = (lines: readonly string[]): string =>
  lines.map((line) => `# ${line}\n`).join("");

const body = (sections: Sections): string => {
  const names = Object.keys(sections).toSorted((left, right) =>
    left.localeCompare(right)
  );
  const ordered = Object.fromEntries(
    [
      ...names.filter((name) => name === "global"),
      ...names.filter((name) => name !== "global"),
    ].map((name) => [name, sections[name]])
  );
  return `${Bun.TOML.stringify(ordered).trim()}\n`;
};

/** The text below the `extends` line. Empty when there is nothing to say. */
export const render = (file: string, result: Translated): string => {
  const differs = Object.keys(result.sections).length > 0;
  const parts = [
    differs
      ? `${comment([
          `Carried over from ${file} by Cinch.`,
          "Only what differs from the Markdown standard is here.",
        ])}${body(result.sections)}`
      : "",
    result.notes.length > 0
      ? comment([
          `Not carried over from ${file}:`,
          ...result.notes.map((note) => `- ${note}`),
        ])
      : "",
  ];
  return parts
    .filter((part) => part !== "")
    .map((part) => `\n${part}`)
    .join("");
};

const blocked = (message: string): Wanted => ({ message, ok: false });

/**
 * What a new config should hold below its `extends` line when the repository
 * still has a config for the old Markdown linter. Null when it has none.
 * Without this the engine stops reading the old config the moment the new
 * file exists, and the repository's own rules are lost without a word.
 */
export const carriedOver = async (
  root: string,
  preset: string
): Promise<Wanted | null> => {
  const source = await findSource(root);
  if (source.kind === "none") {
    return null;
  }
  if (source.kind === "blocked") {
    return blocked(source.message);
  }
  const [translation, catalog] = await Promise.all([
    imported(source.rules),
    ask(["rule", "--output-format", "json"]),
  ]);
  const sections = SectionsSchema.safeParse(translation);
  const known = KnownSchema.safeParse(catalog);
  const standard = SectionsSchema.safeParse(Bun.TOML.parse(preset));
  if (!sections.success || !known.success || !standard.success) {
    return blocked(
      `Cinch needs ${COMMAND} on PATH to carry over the Markdown rules in ${source.file}, and it did not run. Install it and run this again.`
    );
  }
  const result = translate({
    imported: sections.data,
    known: known.data,
    preset: standard.data,
    rules: source.rules,
  });
  return {
    ok: true,
    text: render(source.file, {
      notes: [...result.notes, ...source.notes],
      sections: result.sections,
    }),
  };
};
