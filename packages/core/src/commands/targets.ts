import { createHash } from "node:crypto";
import path from "node:path";

import { z } from "zod";

import type { PackageTarget } from "../contracts/targets.ts";

const Manifest = z.looseObject({
  peerDependencies: z.record(z.string(), z.string()).optional(),
  ropes: z
    .looseObject({ inheritTargets: z.array(z.string()).optional() })
    .optional(),
});

/** Only an explicit package choice inherits a workspace support target. */
const readTarget = async (
  root: string,
  directory: string,
  dependency: string
): Promise<PackageTarget> => {
  const file = path.posix.join(
    directory === "." ? "" : directory,
    "package.json"
  );
  const key = `peerDependencies.${dependency}`;
  const base = { dependency, package: directory };
  try {
    const bytes = await Bun.file(path.join(root, file)).bytes();
    const text = new TextDecoder().decode(bytes);
    const source = {
      file,
      key,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const parsed = Manifest.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return {
        ...base,
        reason: "invalid package manifest",
        source,
        state: "unresolved",
      };
    }
    const range = parsed.data.peerDependencies?.[dependency];
    const inherit =
      parsed.data.ropes?.inheritTargets?.includes(dependency) === true;
    if (inherit && range !== undefined) {
      return {
        ...base,
        reason: "a target cannot be declared and inherited together",
        source,
        state: "unresolved",
      };
    }
    if (inherit && directory !== ".") {
      const inherited = await readTarget(root, ".", dependency);
      return {
        ...inherited,
        ...base,
        inheritedBy: { ...source, key: "ropes.inheritTargets" },
      };
    }
    if (inherit) {
      return {
        ...base,
        reason: "the workspace target cannot inherit itself",
        source,
        state: "unresolved",
      };
    }
    return range === undefined
      ? { ...base, source, state: "absent" }
      : { ...base, range, source, state: "declared" };
  } catch (error) {
    return {
      ...base,
      reason: `cannot read declared target: ${String(error)}`,
      source: { file, key },
      state: "unresolved",
    };
  }
};

/** Read only the manifest facts required by adopted, selected checks. */
export const readTargets = (
  root: string,
  requests: readonly { readonly package: string; readonly dependency: string }[]
): Promise<PackageTarget[]> =>
  Promise.all(
    requests.map((request) =>
      readTarget(root, request.package, request.dependency)
    )
  );
