import type { Adapter } from "../adapters/adapter.ts";
import { compileGlobs } from "../policy/glob.ts";
import { keptWhole } from "../policy/packs.ts";
import type { ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";

const quoted = (globs: readonly string[]): string =>
  globs.map((glob) => JSON.stringify(glob)).join(", ");

/**
 * One line for each named pack that would not run on any file here, because
 * the config leaves out every file the pack reads. A pack runs only on a
 * file the plan covers, so naming it is not enough on its own. A pack whose
 * files could not be planned gets no line. A file Cinch keeps is setup, not
 * one of the repository's own, so it does not count as a file a pack reads.
 */
export const unreached = async (
  request: ReadRequest,
  deps: CommandDeps,
  given: {
    readonly adapters: readonly Adapter[];
    readonly file: string;
    readonly includeDisabled?: boolean;
    readonly names: readonly string[];
    readonly present: readonly string[];
    /** The repository root, which the files in `present` are relative to. */
    readonly root: string;
  }
): Promise<string[]> => {
  const kept = keptWhole(given.adapters.map(({ descriptor }) => descriptor));
  const own = given.present.filter((file) => !kept.has(file));
  const packs = given.adapters
    .flatMap(({ descriptor }) => descriptor.packs ?? [])
    .filter((pack) => given.names.includes(pack.name))
    .map((pack) => ({
      ...pack,
      files: own.filter(compileGlobs(pack.relevant)),
    }))
    .filter((pack) => pack.files.length > 0);
  if (packs.length === 0) {
    return [];
  }
  const planned = await prepare(
    {
      ...request,
      cwd: given.root,
      paths: packs.flatMap((pack) => pack.files),
    },
    deps
  );
  if (!planned.ok) {
    return [];
  }
  const paths = new Map(
    planned.value.plan.paths.map((entry) => [entry.path, entry])
  );
  return packs.flatMap((pack) => {
    const entries = pack.files.flatMap((file) => {
      const entry = paths.get(file);
      return entry === undefined ? [] : [entry];
    });
    const selected = entries.filter((entry) => entry.skipped === undefined);
    if (selected.length > 0) {
      const enabled = selected.some((entry) =>
        entry.policy.some(
          ({ key, value }) => key === "rules.enabled" && value === true
        )
      );
      return given.includeDisabled === true && !enabled
        ? [
            `${pack.name} will not run yet: rules are disabled on every selected file it reads. Review rules.enabled and its path overrides in ${given.file}.`,
          ]
        : [];
    }
    const reasons = new Set(entries.map((entry) => entry.skipped?.reason));
    if (entries.length < pack.files.length || reasons.has(undefined)) {
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
