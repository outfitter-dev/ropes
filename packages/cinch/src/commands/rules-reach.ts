import type { Adapter } from "../adapters/adapter.ts";
import { compileGlobs } from "../policy/glob.ts";
import type { CommandRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";

const quoted = (globs: readonly string[]): string =>
  globs.map((glob) => JSON.stringify(glob)).join(", ");

/**
 * One line for each named pack that would not run on any file here, because
 * the config leaves out every file the pack reads. A pack runs only on a
 * file the plan covers, so naming it is not enough on its own. A pack whose
 * files could not be planned gets no line.
 */
export const unreached = async (
  request: CommandRequest,
  deps: CommandDeps,
  given: {
    readonly adapters: readonly Adapter[];
    readonly file: string;
    readonly names: readonly string[];
    readonly present: readonly string[];
  }
): Promise<string[]> => {
  const packs = given.adapters
    .flatMap(({ descriptor }) => descriptor.packs ?? [])
    .filter((pack) => given.names.includes(pack.name))
    .map((pack) => ({
      ...pack,
      files: given.present.filter(compileGlobs(pack.relevant)),
    }))
    .filter((pack) => pack.files.length > 0);
  if (packs.length === 0) {
    return [];
  }
  const planned = await prepare(
    { ...request, paths: packs.flatMap((pack) => pack.files) },
    deps
  );
  if (!planned.ok) {
    return [];
  }
  const skipped = new Map(
    planned.value.plan.paths.map((entry) => [entry.path, entry.skipped?.reason])
  );
  return packs.flatMap((pack) => {
    const reasons = new Set(pack.files.map((file) => skipped.get(file)));
    if (reasons.has(undefined)) {
      return [];
    }
    const [first = ""] = pack.files;
    const fix = reasons.has("not-included")
      ? `Add ${quoted(pack.relevant)} to \`include\``
      : "Take them out of `exclude`";
    return [
      `${pack.name} will not run yet: ${given.file} leaves out the files it reads, such as ${first}. ${fix} to run it.`,
    ];
  });
};
