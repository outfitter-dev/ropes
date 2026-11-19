import path from "node:path";

import { DEFAULT_CONFIG } from "../contracts/config.ts";
import type { ConfigError, ConfigResult } from "../contracts/config.ts";
import { parseConfigTable } from "./parse.ts";

/** The shared file. Its `[cinch]` table configures Cinch. */
export const SHARED_FILE = "outfitter.toml";
/** The standalone file, for a repository that uses Cinch on its own. */
export const STANDALONE_FILE = "cinch.toml";

type Read =
  | { readonly kind: "absent" }
  | { readonly kind: "table"; readonly table: unknown }
  | { readonly kind: "error"; readonly error: ConfigError };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const readToml = async (root: string, name: string): Promise<Read> => {
  let text = "";
  try {
    const file = Bun.file(path.join(root, name));
    if (!(await file.exists())) {
      return { kind: "absent" };
    }
    text = await file.text();
  } catch (error) {
    return {
      error: { file: name, kind: "unreadable", message: messageOf(error) },
      kind: "error",
    };
  }
  try {
    return { kind: "table", table: Bun.TOML.parse(text) };
  } catch (error) {
    return {
      error: { file: name, kind: "malformed", message: messageOf(error) },
      kind: "error",
    };
  }
};

/** The `[cinch]` table of the shared file, when the file has one. */
const sharedTable = (read: Read): Read => {
  if (read.kind !== "table") {
    return read;
  }
  const { table } = read;
  return typeof table === "object" && table !== null && "cinch" in table
    ? { kind: "table", table: table.cinch }
    : { kind: "absent" };
};

/**
 * Names the file in `dir` that configures Cinch, or null. An `outfitter.toml`
 * counts only when it has a `[cinch]` table, so a nested one written for
 * another tool does not hide the config above it. A file that cannot be read
 * still counts: the loader is where its error gets reported.
 */
export const configFileIn = async (dir: string): Promise<string | null> => {
  const [sharedFile, standalone] = await Promise.all([
    readToml(dir, SHARED_FILE),
    readToml(dir, STANDALONE_FILE),
  ]);
  if (sharedTable(sharedFile).kind !== "absent") {
    return SHARED_FILE;
  }
  return standalone.kind === "absent" ? null : STANDALONE_FILE;
};

/**
 * Reads the pilot config under `root`. The `[cinch]` table in `outfitter.toml`
 * and a standalone `cinch.toml` are alternatives: having both is an error,
 * never a merge. With neither, the defaults apply. Errors come back as data.
 */
export const loadConfig = async (root: string): Promise<ConfigResult> => {
  const [sharedFile, standalone] = await Promise.all([
    readToml(root, SHARED_FILE),
    readToml(root, STANDALONE_FILE),
  ]);
  const shared = sharedTable(sharedFile);
  if (shared.kind === "error") {
    return { error: shared.error, ok: false };
  }
  if (standalone.kind === "error") {
    return { error: standalone.error, ok: false };
  }
  if (shared.kind === "table" && standalone.kind === "table") {
    return {
      error: { files: [SHARED_FILE, STANDALONE_FILE], kind: "conflict" },
      ok: false,
    };
  }
  if (shared.kind === "table") {
    return parseConfigTable(shared.table, {
      file: SHARED_FILE,
      prefix: "cinch.",
    });
  }
  if (standalone.kind === "table") {
    return parseConfigTable(standalone.table, {
      file: STANDALONE_FILE,
      prefix: "",
    });
  }
  return { ok: true, value: DEFAULT_CONFIG };
};
