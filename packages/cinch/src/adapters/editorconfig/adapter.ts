import type { EditorSettings } from "../../contracts/editor.ts";
import type { Adapter } from "../adapter.ts";
import { managedAdapter } from "../managed.ts";
import type { Wanted } from "../managed.ts";
import { MARK, render } from "./render.ts";

/** The format cannot extend another file and is read only from here. */
export const EDITOR_PATH = ".editorconfig";

const STALE =
  "This file differs from `[editor]` in the Cinch config. Make the change there, then run `cinch doctor --fix`.";
const BY_HAND = `This file was written by hand, and the Cinch config has an \`[editor]\` table that Cinch writes it from. Move its settings into \`[editor]\` and delete this file, then run \`cinch doctor --fix\`.`;

/**
 * A file Cinch generated is rewritten freely. One a person wrote is never
 * overwritten: it holds settings the table may not, and they would be lost.
 */
const want = (current: string | null, settings: EditorSettings): Wanted => {
  if (current === null) {
    return { ok: true, text: render(settings) };
  }
  return current.startsWith(MARK)
    ? { ok: true, text: render(settings), why: STALE }
    : { message: BY_HAND, ok: false };
};

/**
 * Keeps the root file editors read, written whole from the `[editor]` table
 * of the Cinch config.
 */
export const editorFileAdapter = (settings: EditorSettings): Adapter =>
  managedAdapter({
    enabledBy: "editor.file",
    files: [
      {
        path: EDITOR_PATH,
        want: (current) => Promise.resolve(want(current, settings)),
      },
    ],
    id: "editor-file",
  });
