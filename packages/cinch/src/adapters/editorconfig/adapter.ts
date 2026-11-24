import type { EditorSettings } from "../../contracts/editor.ts";
import type { Adapter } from "../adapter.ts";
import { managedAdapter } from "../managed.ts";
import type { Wanted } from "../managed.ts";
import { EDITOR_PATH } from "./path.ts";
import { readFile } from "./read.ts";
import { editorRelocates } from "./relocate.ts";
import { MARK, render } from "./render.ts";
import { handWritten } from "./source.ts";

export { EDITOR_PATH } from "./path.ts";

const STALE =
  "This file differs from `[editor]` in the Cinch config. Make the change there, then run `rope doctor --fix`.";
const BY_HAND = `This file was written by hand, and the Cinch config has an \`[editor]\` table that Cinch writes it from. Run \`rope preset adopt editor\` to see how the two differ, make the table state what you want and delete this file, then run \`rope doctor --fix\`.`;

const SAME =
  "This file was written by hand and states what `[editor]` in the Cinch config states. Run `rope doctor --fix` to have Cinch write it from the table.";

/** A file a person wrote: replaced only when nothing in it would be lost. */
const byHand = (current: string, settings: EditorSettings): Wanted => {
  const read = readFile(current);
  if (read.dropped.length > 0) {
    return {
      message: `${BY_HAND} The table cannot hold ${read.dropped.join("; ")}.`,
      ok: false,
    };
  }
  const text = render(settings);
  return render(read.settings) === text
    ? { ok: true, text, why: SAME }
    : { message: BY_HAND, ok: false };
};

/**
 * A file Cinch generated is rewritten freely. One a person wrote is
 * overwritten only when the table states exactly what it states. Otherwise
 * it holds settings the table does not, and they would be lost.
 */
const want = (current: string | null, settings: EditorSettings): Wanted => {
  if (current === null) {
    return { ok: true, text: render(settings) };
  }
  return current.startsWith(MARK)
    ? { ok: true, text: render(settings), why: STALE }
    : byHand(current, settings);
};

/**
 * Keeps the root file editors read, written whole from the `[editor]` table
 * of the Cinch config. Without a table it keeps nothing, and only offers a
 * hand-written file to a first Cinch config.
 */
export const editorFileAdapter = (settings?: EditorSettings): Adapter =>
  managedAdapter({
    enabledBy: "editor.file",
    files:
      settings === undefined
        ? []
        : [
            {
              path: EDITOR_PATH,
              want: (current) => Promise.resolve(want(current, settings)),
            },
          ],
    id: "editor-file",
    migrates: [handWritten],
    moves: { files: [EDITOR_PATH], name: "editor" },
    relocates: editorRelocates,
  });
