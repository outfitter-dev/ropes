import path from "node:path";

import { DEFAULT_CONFIG } from "../contracts/config.ts";
import type { ConfigError, ConfigResult } from "../contracts/config.ts";
import { parseConfigTable } from "./parse.ts";

/** The shared file. Its `[cinch]` table configures Cinch. */
export const SHARED_FILE = "outfitter.toml";
/** The standalone file, for a repository that uses Cinch on its own. */
export const STANDALONE_FILE = "cinch.toml";
/** The Ropes standalone file. The pilot also reads the legacy sources. */
export const ROPES_FILE = "rope.toml";

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
 * Names the file in `dir` that configures Ropes, or null. An `outfitter.toml`
 * counts only when it has a `[cinch]` table, so a nested one written for
 * another tool does not hide the config above it. A file that cannot be read
 * still counts: the loader is where its error gets reported.
 */
export const configFileIn = async (dir: string): Promise<string | null> => {
  const [sharedFile, standalone, ropes] = await Promise.all([
    readToml(dir, SHARED_FILE),
    readToml(dir, STANDALONE_FILE),
    readToml(dir, ROPES_FILE),
  ]);
  if (sharedTable(sharedFile).kind !== "absent") {
    return SHARED_FILE;
  }
  if (standalone.kind !== "absent") {
    return STANDALONE_FILE;
  }
  return ropes.kind === "absent" ? null : ROPES_FILE;
};

/**
 * Reads the pilot config under `root`. `rope.toml`, `cinch.toml` and the
 * `[cinch]` table in `outfitter.toml` are alternatives. Multiple sources are
 * an error. With none, the defaults apply. Errors come back as data.
 */
export const loadConfig = async (
  root: string,
  starter = DEFAULT_CONFIG
): Promise<ConfigResult> => {
  const [sharedFile, standalone, ropes] = await Promise.all([
    readToml(root, SHARED_FILE),
    readToml(root, STANDALONE_FILE),
    readToml(root, ROPES_FILE),
  ]);
  const shared = sharedTable(sharedFile);
  if (shared.kind === "error") {
    return { error: shared.error, ok: false };
  }
  if (standalone.kind === "error") {
    return { error: standalone.error, ok: false };
  }
  if (ropes.kind === "error") {
    return { error: ropes.error, ok: false };
  }
  const files = [
    ...(shared.kind === "table" ? [SHARED_FILE] : []),
    ...(standalone.kind === "table" ? [STANDALONE_FILE] : []),
    ...(ropes.kind === "table" ? [ROPES_FILE] : []),
  ];
  if (files.length > 1) {
    return {
      error: { files, kind: "conflict" },
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
  if (ropes.kind === "table") {
    return parseConfigTable(ropes.table, {
      file: ROPES_FILE,
      prefix: "",
    });
  }
  return { ok: true, value: starter };
};
