import { stat } from "node:fs/promises";
import path from "node:path";

import { Glob, YAML } from "bun";

import { exec } from "../exec.ts";

/** The rules a repository wrote, read from the folders it names. */
export type LocalRules =
  | {
      readonly ok: true;
      /** Root-relative, in the order they are handed to the engine. */
      readonly files: readonly string[];
      readonly ids: ReadonlySet<string>;
      readonly texts: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

/** A folder of rules, and the setting that names it. */
export interface RuleFolder {
  readonly folder: string;
  readonly namedBy: string;
}

const NONE: LocalRules = { files: [], ids: new Set(), ok: true, texts: [] };
const RULE_FILES = new Glob("**/*.{yml,yaml}");

/** The id of each rule in a file. Null when one cannot be read. */
const idsIn = (text: string): string[] | null => {
  let parsed: unknown = null;
  try {
    parsed = YAML.parse(text);
  } catch {
    return null;
  }
  const rules: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const ids = rules.map((rule) =>
    typeof rule === "object" && rule !== null && "id" in rule ? rule.id : null
  );
  return ids.every((id) => typeof id === "string" && id !== "")
    ? ids.map(String)
    : null;
};

const isFolder = async (folder: string): Promise<boolean> => {
  try {
    const found = await stat(folder);
    return found.isDirectory();
  } catch {
    return false;
  }
};

const filesOf = async (root: string, folder: string): Promise<string[]> => {
  const found = await Array.fromAsync(
    RULE_FILES.scan({ cwd: path.join(root, folder), dot: true })
  );
  return found.toSorted().map((file) => path.posix.join(folder, file));
};

/**
 * Reads every rule file under the folders. An id may be used once: a second
 * rule with it, or one a shipped rule has, is refused, since the engine
 * would run both and a finding could not say whose rule it is.
 */
export const readLocal = async (
  root: string,
  folders: readonly RuleFolder[],
  shipped: ReadonlySet<string>
): Promise<LocalRules> => {
  if (folders.length === 0) {
    return NONE;
  }
  const real = await Promise.all(
    folders.map(({ folder }) => isFolder(path.join(root, folder)))
  );
  const missing = folders.find((_, index) => real[index] !== true);
  if (missing !== undefined) {
    return {
      message: `${missing.namedBy} names ${missing.folder}, which is not a folder here`,
      ok: false,
    };
  }
  const listed = await Promise.all(
    folders.map(({ folder }) => filesOf(root, folder))
  );
  const files = [...new Set(listed.flat())];
  const texts = await Promise.all(
    files.map((file) => Bun.file(path.join(root, file)).text())
  );
  const owner = new Map<string, string>();
  for (const [index, file] of files.entries()) {
    const ids = idsIn(texts[index] ?? "");
    if (ids === null) {
      return {
        message: `${file}: no rule id could be read from it`,
        ok: false,
      };
    }
    for (const id of ids) {
      const taken = shipped.has(id) ? "a rule Ropes ships" : owner.get(id);
      if (taken !== undefined) {
        return {
          message: `${file}: the id ${id} is already used by ${taken}. Give the rule another id`,
          ok: false,
        };
      }
      owner.set(id, file);
    }
  }
  return {
    files,
    ids: new Set(owner.keys()),
    ok: true,
    texts: texts.map((text) => text.trim()),
  };
};

const CAUSE = /^╰▻ (?<cause>.+)$/u;

/** What the engine last said was wrong, in one line. */
const causeIn = (stderr: string): string =>
  stderr
    .split("\n")
    .map((line) => CAUSE.exec(line.trim())?.groups?.cause)
    .findLast((cause) => cause !== undefined) ?? "the engine refused it";

/**
 * The first local rule file the engine refuses on its own, and why. The
 * engine does not say which rule of several it could not read, so each
 * file is tried alone. Null when it takes every one.
 */
export const refusedFile = async (
  binary: string,
  root: string,
  files: readonly string[]
): Promise<string | null> => {
  const tried = await Promise.all(
    files.map((file) =>
      exec([binary, "scan", "--rule", file, "--json=compact", file], root)
    )
  );
  const index = tried.findIndex(({ exitCode }) => exitCode > 1);
  const file = files[index];
  return file === undefined
    ? null
    : `${file}: ${causeIn(tried[index]?.stderr ?? "")}`;
};
