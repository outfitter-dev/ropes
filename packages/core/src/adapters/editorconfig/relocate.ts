import path from "node:path";

import { EditorSchema } from "../../contracts/editor.ts";
import type { ConfigText, Relocates, Relocation } from "../relocation.ts";
import { EDITOR_PATH } from "./path.ts";
import { readFile } from "./read.ts";
import { isMarked, render } from "./render.ts";
import { tableOf } from "./source.ts";

const stop = (...reasons: string[]): Relocation => ({ ok: false, reasons });

const isTable = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The `[editor]` table the config states now, if it states one. */
const stated = (config: ConfigText): unknown => {
  let at: unknown = Bun.TOML.parse(config.text);
  for (const name of [...config.prefix.split("."), "editor"]) {
    if (name !== "") {
      at = isTable(at) ? at[name] : undefined;
    }
  }
  return at;
};

const WRITTEN = `Ropes now writes ${EDITOR_PATH} from the table. Change the table, then run \`rope doctor --fix\`.`;

/**
 * Reads the file a person wrote into the `[editor]` table and hands back
 * the generated file in its place. It stops when the table could not hold
 * a setting the file states, so no setting is lost. Comments are lost, and
 * the move says which.
 */
const adopt = async (root: string, config: ConfigText): Promise<Relocation> => {
  const file = Bun.file(path.join(root, EDITOR_PATH));
  if (!(await file.exists())) {
    return stop(`There is no ${EDITOR_PATH} here to adopt.`);
  }
  const text = await file.text();
  if (isMarked(text)) {
    return { files: [], notes: [], ok: true };
  }
  const read = readFile(text);
  if (read.lost.length > 0) {
    return stop(
      ...read.lost.map((one) => `The \`[editor]\` table cannot hold ${one}.`),
      `Take those out of ${EDITOR_PATH}, or keep the file by hand and leave \`[editor]\` out of ${config.file}.`
    );
  }
  const generated = { path: EDITOR_PATH, text: render(read.settings) };
  const notes = [
    ...(read.comments.length === 0
      ? []
      : [
          `The comments on lines ${read.comments.join(", ")} of ${EDITOR_PATH} are not carried over.`,
        ]),
    WRITTEN,
  ];
  const table = stated(config);
  if (table === undefined) {
    const lines = tableOf(text, config.prefix);
    return {
      files: [
        {
          path: config.file,
          text: `${config.text.trimEnd()}\n\n${lines.join("\n")}`,
        },
        generated,
      ],
      notes,
      ok: true,
    };
  }
  const parsed = EditorSchema.safeParse(table);
  return parsed.success && render(parsed.data) === generated.text
    ? { files: [generated], notes, ok: true }
    : stop(
        `\`[editor]\` in ${config.file} already states other settings than ${EDITOR_PATH} does.`,
        `Make the table state what you want and delete ${EDITOR_PATH}, then run \`rope doctor --fix\`.`
      );
};

/** There is no file a person owns to move the table into: it has no `extends`. */
const eject = (_root: string, config: ConfigText): Promise<Relocation> =>
  Promise.resolve(
    stop(
      `Ropes writes ${EDITOR_PATH} only from \`[editor]\`, so there is nothing to move.`,
      `To keep the file by hand, delete the \`[editor]\` table from ${config.file} and the first two lines of ${EDITOR_PATH}. Ropes then leaves the file alone.`
    )
  );

export const editorRelocates: Relocates = { adopt, eject };
