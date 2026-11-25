import path from "node:path";

import { z } from "zod";

import { ageSeconds } from "../../contracts/install.ts";
import type { InstallSettings } from "../../contracts/install.ts";
import type { ManagedFile, Wanted } from "../managed.ts";

const FILES = [
  "renovate.json",
  "renovate.jsonc",
  "renovate.json5",
  ".github/renovate.json",
  ".github/renovate.jsonc",
  ".github/renovate.json5",
  ".gitlab/renovate.json",
  ".gitlab/renovate.jsonc",
  ".gitlab/renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.jsonc",
  ".renovaterc.json5",
  "package.json",
];
const Package = z.looseObject({ renovate: z.unknown().optional() });
const Config = z.looseObject({
  extends: z.array(z.string()).optional(),
  minimumReleaseAge: z.string().optional(),
});

const compare = (
  text: string | null,
  settings: InstallSettings,
  file: string
): Promise<Wanted> => {
  if (text === null) {
    return Promise.resolve({
      message: "The selected Renovate config is missing.",
      ok: false,
      unknown: true,
    });
  }
  try {
    const parsed: unknown = Bun.JSONC.parse(text);
    const config = Config.parse(
      file === "package.json" ? Package.parse(parsed).renovate : parsed
    );
    const wanted = settings.minimum_release_age;
    if (wanted === undefined) {
      return Promise.resolve({ ok: true, text });
    }
    if (
      config.minimumReleaseAge === undefined &&
      (config.extends?.length ?? 0) > 0
    ) {
      return Promise.resolve({
        message:
          "Renovate inherits its minimumReleaseAge. State the shared age locally so it can be compared.",
        ok: false,
        unknown: true,
      });
    }
    const seconds =
      config.minimumReleaseAge === undefined
        ? 0
        : ageSeconds(config.minimumReleaseAge);
    return Promise.resolve(
      seconds === ageSeconds(wanted)
        ? { ok: true, text }
        : {
            message:
              "Renovate minimumReleaseAge differs from [install].minimum_release_age. Update the authored Renovate config.",
            ok: false,
          }
    );
  } catch {
    return Promise.resolve({
      message:
        "The authored Renovate config could not be read for install policy comparison.",
      ok: false,
      unknown: true,
    });
  }
};

/** Existing configs are checked in place and are never generated or repaired. */
export const renovateFiles = async (
  root: string,
  settings: InstallSettings
): Promise<ManagedFile[]> => {
  const exists = await Promise.all(
    FILES.map((file) => Bun.file(path.join(root, file)).exists())
  );
  const file = FILES.find((_, index) => exists[index] === true);
  if (file === undefined) {
    return [];
  }
  if (file === "package.json") {
    try {
      const parsed: unknown = Bun.JSONC.parse(
        await Bun.file(path.join(root, file)).text()
      );
      if (Package.parse(parsed).renovate === undefined) {
        return [];
      }
    } catch {
      // The active fallback is unreadable, so comparison must be incomplete.
    }
  }
  return [
    {
      layer: "root",
      path: file,
      want: (text) => compare(text, settings, file),
    },
  ];
};
