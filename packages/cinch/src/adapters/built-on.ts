import path from "node:path";

import { semver } from "bun";

/** A package a shipped preset imports, and the version it was written for. */
export interface BuiltOn {
  readonly name: string;
  /** An exact version. A later release of the same major is accepted. */
  readonly version: string;
}

/** The rule a finding about a preset's package is reported under. */
export const BUILT_ON_RULE = "cinch/preset-dependency";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const versionIn = async (manifest: string): Promise<string | null> => {
  try {
    const file = Bun.file(manifest);
    if (!(await file.exists())) {
      return null;
    }
    const parsed: unknown = await file.json();
    return isRecord(parsed) && typeof parsed.version === "string"
      ? parsed.version
      : null;
  } catch {
    return null;
  }
};

/**
 * The version of a package as the repository at `root` would import it:
 * the nearest `node_modules` at or above the root. Null when no folder
 * there holds it, or its manifest states no version.
 */
export const installedVersion = async (
  name: string,
  root: string
): Promise<string | null> => {
  let folder = path.resolve(root);
  for (;;) {
    const manifest = path.join(folder, "node_modules", name, "package.json");
    // The nearest folder wins, so they are read one at a time, in order.
    // eslint-disable-next-line no-await-in-loop
    if (await Bun.file(manifest).exists()) {
      // eslint-disable-next-line no-await-in-loop
      return await versionIn(manifest);
    }
    const above = path.dirname(folder);
    if (above === folder) {
      return null;
    }
    folder = above;
  }
};

/**
 * What is wrong with the installed version of a package a preset imports,
 * or null when the preset can count on it. An older release, or another
 * major, may not have what the preset imports. A later release of the same
 * major is taken on trust.
 */
export const builtOnProblem = (
  needs: BuiltOn,
  found: string | null
): string | null => {
  const { name, version } = needs;
  if (found === null) {
    return `This preset imports \`${name}\`, which is not installed. Add ${name} ${version} as a dev dependency.`;
  }
  return semver.satisfies(found, `^${version}`)
    ? null
    : `This preset was written for ${name} ${version}, and ${found} is installed. Install ${version}, or a later release of the same major version.`;
};
