import { lstat } from "node:fs/promises";
import path from "node:path";

import type { ConfigError } from "../contracts/config.ts";

export const pathPresent = async (target: string): Promise<boolean> => {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    throw error;
  }
};

/** Detect retired inputs before a policy is parsed or an engine is selected. */
export const legacyConfig = async (
  root: string,
  options: { readonly ignoreSharedErrors?: boolean } = {}
): Promise<ConfigError | null> => {
  let file = path.join(root, "cinch.toml");
  try {
    if (await pathPresent(file)) {
      return {
        file,
        kind: "legacy",
        replacement:
          "Move its policy to rope.toml and remove cinch.toml before running rope.",
      };
    }
    file = path.join(root, ".outfitter/configs");
    if (await pathPresent(file)) {
      return {
        file,
        kind: "legacy",
        replacement:
          "Regenerate managed files under .ropes/configs, update root tool references, and remove .outfitter/configs before running rope.",
      };
    }
    file = path.join(root, "outfitter.toml");
    if (!(await pathPresent(file))) {
      return null;
    }
    const shared: unknown = Bun.TOML.parse(await Bun.file(file).text());
    return typeof shared === "object" && shared !== null && "cinch" in shared
      ? {
          file,
          kind: "legacy",
          replacement:
            "Move the [cinch] policy to rope.toml and remove that table. Keep unrelated shared tables in outfitter.toml.",
        }
      : null;
  } catch (error) {
    if (
      options.ignoreSharedErrors === true &&
      file === path.join(root, "outfitter.toml")
    ) {
      return null;
    }
    return {
      file,
      kind: "unreadable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
