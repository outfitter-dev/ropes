import path from "node:path";

import type { EditorFacts } from "../../contracts/editor.ts";
import type { Inherited, MigrationSource } from "../adapter.ts";
import { EDITOR_PATH } from "./path.ts";
import { readFile } from "./read.ts";
import { MARK } from "./render.ts";

const pairs = (facts: EditorFacts): string[] =>
  Object.entries(facts).map(
    ([key, value]) => `${key} = ${JSON.stringify(value)}`
  );

/** The lines of the `[editor]` table that state what the file stated. */
export const tableOf = (text: string, prefix = ""): string[] => {
  const { dropped, settings } = readFile(text);
  const { overrides = [], ...base } = settings;
  return [
    `# The facts ${EDITOR_PATH} stated, carried over by Cinch.`,
    ...dropped.map((one) => `# Not carried over: ${one}.`),
    `[${prefix}editor]`,
    ...pairs(base),
    ...overrides.flatMap(({ files, ...facts }) => [
      "",
      `[[${prefix}editor.overrides]]`,
      `files = ${JSON.stringify(files)}`,
      ...pairs(facts),
    ]),
    "",
  ];
};

const inherits = async (root: string): Promise<Inherited | null> => {
  const file = Bun.file(path.join(root, EDITOR_PATH));
  if (!(await file.exists())) {
    return null;
  }
  const text = await file.text();
  // A generated file has a table already, in a config `init` cannot see.
  return text.startsWith(MARK)
    ? null
    : {
        exclude: [],
        from: EDITOR_PATH,
        include: [],
        keeps: [EDITOR_PATH],
        kinds: [],
        notes: [],
        tables: tableOf(text),
      };
};

/** A hand-written file, read into the table a first Cinch config states. */
export const handWritten: MigrationSource = { id: "editor-file", inherits };
