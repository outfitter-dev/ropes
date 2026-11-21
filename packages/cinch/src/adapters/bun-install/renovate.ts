import path from "node:path";

import { z } from "zod";

import { ageSeconds } from "../../contracts/install.ts";
import type { InstallSettings } from "../../contracts/install.ts";
import type { ManagedFile, Wanted } from "../managed.ts";

const FILES = [
  "renovate.json",
  "renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.json5",
  ".github/renovate.json",
  ".github/renovate.json5",
];
const Config = z.looseObject({
  extends: z.array(z.string()).optional(),
  minimumReleaseAge: z.string().optional(),
});

const compare = (
  text: string | null,
  settings: InstallSettings
): Promise<Wanted> => {
  if (text === null) {
    return Promise.resolve({
      message: "The selected Renovate config is missing.",
      ok: false,
      unknown: true,
    });
  }
  try {
    const config = Config.parse(Bun.JSONC.parse(text));
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
  return FILES.filter((_, index) => exists[index] === true).map((file) => ({
    path: file,
    want: (text) => compare(text, settings),
  }));
};
