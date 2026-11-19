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

const readToml = async (root: string, name: string): Promise<Read> => {
  const file = Bun.file(path.join(root, name));
  if (!(await file.exists())) {
    return { kind: "absent" };
  }
  try {
    return { kind: "table", table: Bun.TOML.parse(await file.text()) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: { file: name, kind: "malformed", message }, kind: "error" };
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
