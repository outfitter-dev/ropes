import path from "node:path";

import type { Fact, FactReport } from "../../contracts/facts.ts";
import { exec } from "../exec.ts";

/** The shared facts rumdl has a setting for. */
export const REPORTS = ["line_width"] as const;

/**
 * Where rumdl keeps each fact, widest setting first. rumdl hands a global
 * value down to the rule that uses it, with the same file named, so the
 * rule's own setting counts only when it says something else.
 */
const SETTINGS: Readonly<Record<(typeof REPORTS)[number], readonly string[]>> =
  { line_width: ["global.line-length", "MD013.line-length"] };

const SECTION = /^\[(?<name>[^\]]+)\]$/u;
const SETTING = /^(?<key>[\w-]+) = (?<value>.*?)\s+\[from (?<from>[^\]]+)\]$/u;

/** What a file sets: rumdl's built-in defaults are left out. */
const DEFAULT = "default";

interface Resolved {
  readonly from: string;
  readonly value: string;
}

/**
 * Reads what `rumdl config` prints: a section header, then one line for each
 * setting with the file it came from. rumdl spells a key with `-` in one
 * section and `_` in another, so both read as `-`.
 */
export const parseResolved = (text: string): Map<string, Resolved> => {
  const settings = new Map<string, Resolved>();
  let section = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    section = SECTION.exec(trimmed)?.groups?.name ?? section;
    const { from, key, value } = SETTING.exec(trimmed)?.groups ?? {};
    if (from !== undefined && key !== undefined && value !== undefined) {
      settings.set(`${section}.${key.replaceAll("_", "-")}`, { from, value });
    }
  }
  return settings;
};

const valueOf = (text: string): number | string | boolean => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "number" || typeof parsed === "boolean"
      ? parsed
      : text;
  } catch {
    return text;
  }
};

/** The setting that decides a fact: the narrowest one a file sets. */
const deciding = (
  settings: Map<string, Resolved>,
  keys: readonly string[]
): { readonly key: string; readonly found: Resolved } | undefined => {
  const set = keys.flatMap((key) => {
    const found = settings.get(key);
    return found === undefined || found.from === DEFAULT
      ? []
      : [{ found, key }];
  });
  const [widest] = set;
  return (
    set.findLast((entry) => entry.found.value !== widest?.found.value) ?? widest
  );
};

/** The facts in what rumdl printed, each with the file that sets it. */
export const factsIn = (text: string, root: string): Fact[] => {
  const settings = parseResolved(text);
  return REPORTS.flatMap((name) => {
    const decided = deciding(settings, SETTINGS[name]);
    if (decided === undefined) {
      return [];
    }
    const { found, key } = decided;
    const file = path.isAbsolute(found.from)
      ? path.relative(root, found.from)
      : found.from;
    return [{ file, key, name, value: valueOf(found.value) }];
  });
};

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

/**
 * Asks rumdl for the config it resolves at the root, through the same chain
 * of files it reads when it lints.
 */
export const readFacts = async (
  command: string,
  root: string
): Promise<FactReport> => {
  const { exitCode, stderr, stdout } = await exec(
    [Bun.which(command) ?? command, "config", "--color", "never"],
    root
  );
  return exitCode === 0
    ? { facts: factsIn(stdout, root), ok: true }
    : {
        ok: false,
        reason:
          firstLine(stderr) ||
          firstLine(stdout) ||
          `${command} config exited ${exitCode}`,
      };
};
