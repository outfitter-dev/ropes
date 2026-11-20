import path from "node:path";

import type { ManagedFile, Wanted } from "../managed.ts";
import { PRESET_PATH, ROOT_PATH } from "./paths.ts";

const KEY = "extends";
const TARGET = `./${PRESET_PATH}`;
const WITHOUT_EXTENSION = PRESET_PATH.slice(0, -".json".length);
const LINE = `"${KEY}": "${TARGET}"`;
const FRESH = `{\n  ${LINE}\n}\n`;

const OWN = `${ROOT_PATH} is the repository's own, so Cinch will not rewrite it.`;
const OFF = "set `preset = false` under `[typescript]` in the Cinch config";

/** The file as an object, or null when it is not one. Comments are allowed. */
const parse = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = Bun.JSONC.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? { ...parsed }
      : null;
  } catch {
    return null;
  }
};

const relativeConfigPath = (named: unknown): string | undefined => {
  if (typeof named !== "string") {
    return undefined;
  }
  const slashed = named.replaceAll("\\", "/");
  return slashed.startsWith("./") || slashed.startsWith("../")
    ? path.posix.normalize(slashed).replace(/\/$/u, "")
    : undefined;
};

/** Where the file's opening brace is, past any comment before it. */
const opening = (text: string): number => {
  let at = 0;
  while (at < text.length) {
    if (text.startsWith("//", at)) {
      const end = text.indexOf("\n", at);
      at = end === -1 ? text.length : end + 1;
    } else if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at);
      at = end === -1 ? text.length : end + 2;
    } else if (text[at] === "{") {
      return at;
    } else {
      at += 1;
    }
  }
  return -1;
};

/**
 * The file with the `extends` key as its first, and every other character
 * as it was. Null when the result would not read back as the same settings.
 */
const withExtends = (
  text: string,
  before: Record<string, unknown>
): string | null => {
  const at = opening(text);
  if (at === -1) {
    return null;
  }
  const empty = Object.keys(before).length === 0;
  const added = `${text.slice(0, at + 1)}\n  ${LINE}${empty ? "\n" : ","}${text.slice(at + 1)}`;
  return Bun.deepEquals(parse(added), { ...before, [KEY]: TARGET })
    ? added
    : null;
};

const ADD = `${OWN} It does not extend the preset Cinch keeps. Add \`${LINE}\`, or run \`cinch doctor --fix\`, which adds it and changes nothing else.`;

const want = async (current: string | null, root: string): Promise<Wanted> => {
  if (current === null) {
    return { ok: true, text: FRESH };
  }
  const parsed = parse(current);
  if (parsed === null) {
    return {
      message: `${OWN} It could not be read, so Cinch cannot tell whether it extends ${PRESET_PATH}.`,
      ok: false,
    };
  }
  const named = parsed[KEY];
  const relative = new Set(
    (Array.isArray(named) ? named : [named]).map(relativeConfigPath)
  );
  if (
    relative.has(PRESET_PATH) ||
    (relative.has(WITHOUT_EXTENSION) &&
      !(await Bun.file(path.join(root, WITHOUT_EXTENSION)).exists()))
  ) {
    return { ok: true, text: current };
  }
  if (named !== undefined) {
    return {
      message: `${OWN} It extends ${JSON.stringify(named)}, not the preset Cinch keeps. Make \`${KEY}\` a list with \`"${TARGET}"\` first, so what the repository extends today still wins, or ${OFF}.`,
      ok: false,
    };
  }
  const added = withExtends(current, parsed);
  return added === null
    ? { message: `${OWN} Add \`${LINE}\` to it, or ${OFF}.`, ok: false }
    : { ok: true, text: added, why: ADD };
};

/**
 * The compiler's config must extend the preset. A missing file is written
 * with that one key. A file with no `extends` gets the key and nothing
 * else. One that extends something else is left for a person, since the
 * order of the two decides which wins.
 */
export const rootConfig: ManagedFile = {
  beside: [WITHOUT_EXTENSION],
  layer: "root",
  path: ROOT_PATH,
  want,
};
