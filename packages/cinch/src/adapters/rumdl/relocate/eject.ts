import path from "node:path";

import type { ToolTable } from "../../../contracts/config.ts";
import type { ConfigText, Relocation } from "../../relocation.ts";
import { generated } from "../generated.ts";
import { CONFIG_PATH, EXTENDS, GENERATED_PATH } from "../paths.ts";
import { isPointer } from "../root-config.ts";
import { familyOf } from "./absorb.ts";
import { commentsIn, renamed, sectionsOf, textOf } from "./scan.ts";
import type { Line, Section } from "./scan.ts";
import { parsed, same, withTable } from "./tables.ts";

const stop = (...reasons: readonly string[]): Relocation => ({
  ok: false,
  reasons,
});

const linesOf = (section: Section): Line[] => [
  ...section.lead,
  ...(section.header === null ? [] : [section.header]),
  ...section.body,
];

/**
 * The Cinch config split by line: what is left once the engine's tables are
 * taken out, and those tables as a config of the engine's own.
 */
const split = (
  text: string,
  family: string
): { readonly left: string; readonly taken: string } => {
  const sections = sectionsOf(text);
  const inFamily = ({ header }: Section): boolean =>
    header?.name === family || header?.name.startsWith(`${family}.`) === true;
  const top = sections.filter((section) => section.header?.name === family);
  const rest = sections.filter(
    (section) => inFamily(section) && section.header?.name !== family
  );
  const taken: Line[] = [
    // Keys with no table come first: TOML has no way back out of a table.
    ...top.flatMap((section) => [...section.lead, ...section.body]),
    ...rest.flatMap((section) =>
      section.header === null
        ? []
        : [
            ...section.lead,
            renamed(
              section.header,
              section.header.raw.trim().slice(family.length + 1)
            ),
            ...section.body,
          ]
    ),
  ];
  return {
    left: textOf(
      sections.filter((section) => !inFamily(section)).flatMap(linesOf)
    ),
    taken: textOf(taken),
  };
};

/**
 * Moves the engine's table out of the Cinch config into a root config the
 * repository owns, which keeps its `extends` line. The settings go up one
 * layer, above the same layers as before, so the engine resolves the same.
 */
export const eject = async (
  root: string,
  config: ConfigText,
  table: ToolTable = {}
): Promise<Relocation> => {
  if (Object.keys(table).length === 0) {
    return { files: [], notes: [], ok: true };
  }
  const file = Bun.file(path.join(root, CONFIG_PATH));
  const current = (await file.exists()) ? await file.text() : null;
  if (!isPointer(current)) {
    return stop(
      `${CONFIG_PATH} is the repository's own, so Cinch will not overwrite it. Move the settings into it by hand, or delete it and run this again.`
    );
  }
  const family = familyOf(config);
  const before = parsed(config.text);
  const { left, taken } = split(config.text, family.join("."));
  const after = parsed(left);
  if (
    before === null ||
    after === null ||
    !same(after, withTable(before, family, {}))
  ) {
    return stop(
      `Cinch could not take \`[${family.join(".")}]\` out of ${config.file} by itself: the table is not written as plain \`[table]\` sections. Move it by hand.`
    );
  }
  const read = parsed(taken);
  const kept = read !== null && same(read, table);
  const body = kept ? taken : Bun.TOML.stringify(table).trim();
  const lost = kept
    ? []
    : sectionsOf(taken).flatMap((section) => commentsIn(linesOf(section)));
  const below = await generated({});
  if (!below.ok) {
    return stop(below.message);
  }
  return {
    files: [
      { path: config.file, text: `${left}\n` },
      { path: GENERATED_PATH, text: below.text },
      { path: CONFIG_PATH, text: `${EXTENDS}\n${body}\n` },
    ],
    notes:
      lost.length === 0
        ? []
        : [
            `These comments in ${config.file} were not carried over:\n${lost.map((line) => `  ${line}`).join("\n")}`,
          ],
    ok: true,
  };
};
