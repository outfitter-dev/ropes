import path from "node:path";

import { DEFAULT_CONFIG } from "../contracts/config.ts";
import type { ConfigError, ConfigResult } from "../contracts/config.ts";
import { legacyConfig } from "./legacy.ts";
import { parseConfigTable } from "./parse.ts";

/** The supported Ropes policy file. */
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

/** Root discovery checks legacy paths separately before choosing a policy. */
export const configFileIn = async (dir: string): Promise<string | null> =>
  (await Bun.file(path.join(dir, ROPES_FILE)).exists()) ? ROPES_FILE : null;

/** Read the Ropes policy after rejecting retired configuration inputs. */
export const loadConfig = async (
  root: string,
  starter = DEFAULT_CONFIG
): Promise<ConfigResult> => {
  const legacy = await legacyConfig(root);
  if (legacy !== null) {
    return { error: legacy, ok: false };
  }
  const ropes = await readToml(root, ROPES_FILE);
  if (ropes.kind === "error") {
    return { error: ropes.error, ok: false };
  }
  return ropes.kind === "table"
    ? parseConfigTable(ropes.table, { file: ROPES_FILE, prefix: "" })
    : { ok: true, value: starter };
};
