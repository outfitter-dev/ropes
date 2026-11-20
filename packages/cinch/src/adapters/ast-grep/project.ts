import path from "node:path";

import { YAML } from "bun";

import type { FoundRules } from "../found.ts";

/** The names the engine finds its project config by, in its order. */
const NAMES = ["sgconfig.yml", "sgconfig.yaml"];
const KEY = "ruleDirs";

export type Project =
  | { readonly ok: true; readonly found?: FoundRules }
  | { readonly ok: false; readonly message: string };

const isOutside = (folder: string): boolean =>
  /^[\\/]/u.test(folder) ||
  /^[A-Za-z]:/u.test(folder) ||
  folder.split(/[\\/]/u).includes("..");

/** The folder as the root sees it: `./rules/` is `rules`. */
export const tidy = (folder: string): string =>
  path.posix.normalize(folder.replaceAll("\\", "/")).replace(/\/$/u, "") || ".";

const foldersIn = (parsed: unknown): readonly unknown[] | null => {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  if (!(KEY in parsed) || parsed[KEY] === null) {
    return [];
  }
  return Array.isArray(parsed[KEY]) ? parsed[KEY] : null;
};

/**
 * The rule folders the repository's own project config names, when the
 * root has one. The engine reads the rest of that file itself, its utility
 * rules among them, since it starts in the root. Nothing is written.
 */
export const readProject = async (root: string): Promise<Project> => {
  const here = await Promise.all(
    NAMES.map((name) => Bun.file(path.join(root, name)).exists())
  );
  const file = NAMES.find((_, index) => here[index] === true);
  if (file === undefined) {
    return { ok: true };
  }
  let parsed: unknown = null;
  try {
    parsed = YAML.parse(await Bun.file(path.join(root, file)).text());
  } catch {
    return { message: `${file}: it could not be read as YAML`, ok: false };
  }
  const named = foldersIn(parsed);
  const folders = (named ?? []).filter(
    (folder) => typeof folder === "string" && folder !== ""
  );
  if (named === null || folders.length !== named.length) {
    return { message: `${file}: ${KEY} must be a list of folders`, ok: false };
  }
  const texts = folders.map(String);
  const outside = texts.find(isOutside);
  if (outside !== undefined) {
    return {
      message: `${file}: ${KEY} names ${outside}, which is outside the repository`,
      ok: false,
    };
  }
  return texts.length === 0
    ? { ok: true }
    : {
        found: { file, folders: [...new Set(texts.map(tidy))], key: KEY },
        ok: true,
      };
};
