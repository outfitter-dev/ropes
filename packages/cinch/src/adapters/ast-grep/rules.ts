import { TOML, YAML } from "bun";
import { z } from "zod";

import { PackManifestSchema } from "../../contracts/rules.ts";
import type { RulePack } from "../../contracts/rules.ts";
import { shippedFolder } from "../shipped-text.ts";

/** Where this Cinch keeps the rules it ships, one folder for each pack. */
const SHIPPED = new URL("../../../rules/", import.meta.url);
const MANIFEST = "pack.toml";
const Scope = z.object({
  files: z.array(z.string()).optional(),
  ignores: z.array(z.string()).optional(),
});

/** A rule file's id is its path with no ending: `<pack>/<rule>`. */
const idOf = (file: string): string => file.replace(/\.yml$/u, "");

/**
 * The rule texts and pack manifests under a shipped folder. A pack is a
 * folder with a manifest named for it, and a rule is a YAML file beside it.
 */
export const readPacks = async (folder: URL) => {
  const files = await shippedFolder(folder);
  const sorted = [...files.entries()].toSorted(([left], [right]) =>
    left < right ? -1 : 1
  );
  const texts = new Map(
    sorted.flatMap(([file, text]): [string, string][] =>
      file.endsWith(".yml") ? [[idOf(file), text.trim()]] : []
    )
  );
  const packs = sorted.flatMap(([file, text]): RulePack[] => {
    const [folderName, name] = file.split("/");
    if (name !== MANIFEST || folderName === undefined) {
      return [];
    }
    const manifest = PackManifestSchema.parse(TOML.parse(text));
    if (manifest.name !== folderName) {
      throw new Error(`${file} names "${manifest.name}", not its folder`);
    }
    const rules = [...texts.keys()].filter((id) =>
      id.startsWith(`${folderName}/`)
    );
    return [{ ...manifest, rules }];
  });
  return { packs, texts };
};

const shipped = await readPacks(SHIPPED);

/** The packs this Cinch ships. A rule outside a pack is never run. */
export const shippedPacks: readonly RulePack[] = shipped.packs;
export const shippedScopes = Object.fromEntries(
  [...shipped.texts].map(([id, text]) => [id, Scope.parse(YAML.parse(text))])
);

/**
 * The shipped rules with these ids, as one text the engine reads from its
 * command line. Nothing is copied into a repository, so a Cinch version is
 * a rules version and no copy can go stale. Left out, it is every rule of
 * every pack.
 */
export const shippedRules = (
  ids: readonly string[] = shippedPacks.flatMap((pack) => pack.rules)
): string => ids.flatMap((id) => shipped.texts.get(id) ?? []).join("\n---\n");

/** Every id a shipped rule has, on or off. */
export const shippedIds: ReadonlySet<string> = new Set(shipped.texts.keys());
