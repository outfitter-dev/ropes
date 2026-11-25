import { stat } from "node:fs/promises";
import path from "node:path";

import { toRootRelative } from "../config/root.ts";
import type { RopesConfig } from "../contracts/config.ts";
import type { Protected } from "../contracts/delegation.ts";

/** Physical equality also covers symlinks and existing hard links. */
const identityOf = async (root: string, file: string) => {
  const [located, metadata] = await Promise.all([
    toRootRelative(root, root, file),
    stat(path.join(root, file), { bigint: true }).catch(() => null),
  ]);
  return {
    file,
    identity:
      metadata?.isFile() === true
        ? `${metadata.dev}:${metadata.ino}`
        : undefined,
    physical: located.ok ? located.value : undefined,
  };
};

type Identity = Awaited<ReturnType<typeof identityOf>>;

const sameFile = (left: Identity, right: Identity): boolean =>
  left.file === right.file ||
  (left.physical !== undefined && left.physical === right.physical) ||
  (left.identity !== undefined && left.identity === right.identity);

/**
 * Snapshot protection before planning. Keep authored names and provenance,
 * and add canonical targets and selected aliases of the same files. Policy
 * stays pure while the authored configuration stays suitable for comparison.
 */
export const protectedPathsAt = async (
  root: string,
  config: RopesConfig,
  selected: readonly string[]
): Promise<ReadonlyMap<string, readonly Protected[]>> => {
  const delegates = (config.delegates ?? []).filter(
    (delegate) => (delegate.config ?? []).length > 0
  );
  const files = delegates.flatMap((delegate) => delegate.config ?? []);
  if (files.length === 0) {
    return new Map<string, readonly Protected[]>();
  }
  const candidates = await Promise.all(
    [...new Set([...files, ...selected])].map((file) => identityOf(root, file))
  );
  const protectedPaths = new Map<string, Protected[]>();
  for (const delegate of delegates) {
    const owned = candidates.filter(
      (candidate) => delegate.config?.includes(candidate.file) === true
    );
    const aliases = candidates.filter((candidate) =>
      owned.some((file) => sameFile(file, candidate))
    );
    const names = new Set(
      aliases.flatMap((alias) =>
        alias.physical === undefined
          ? [alias.file]
          : [alias.file, alias.physical]
      )
    );
    for (const name of names) {
      protectedPaths.set(name, [
        ...(protectedPaths.get(name) ?? []),
        { source: delegate.source, tool: delegate.tool },
      ]);
    }
  }
  return protectedPaths;
};

/** Every file in a direct multi-file mutation is checked before any write. */
export const protectedWriteAt = async (
  root: string,
  config: RopesConfig,
  files: readonly string[]
): Promise<string | undefined> => {
  const protectedPaths = await protectedPathsAt(root, config, files);
  for (const file of files) {
    const [owner] = protectedPaths.get(file) ?? [];
    if (owner !== undefined) {
      return `${file} is protected by ${owner.source.file}: ${owner.source.key} (${owner.tool}), so Ropes cannot write it.`;
    }
  }
  return undefined;
};
