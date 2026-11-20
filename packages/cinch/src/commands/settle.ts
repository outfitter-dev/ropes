import type { Adapter } from "../adapters/adapter.ts";
import type { CinchConfig } from "../contracts/config.ts";
import { isWanted } from "../policy/packs.ts";

/**
 * Each adapter once it has read what the repository says to its engine in
 * the engine's own files. A file that cannot be read stops the run only
 * when policy asks for the adapter: one nobody switched on is left as it
 * was, and its engine's files are not Cinch's to judge.
 */
export const settle = async (
  adapters: readonly Adapter[],
  root: string,
  config: CinchConfig
): Promise<
  | { readonly ok: true; readonly adapters: readonly Adapter[] }
  | { readonly ok: false; readonly error: string }
> => {
  const read = await Promise.all(
    adapters.map(async (adapter) => ({
      adapter,
      settled: await adapter.settled?.(root),
    }))
  );
  const settled: Adapter[] = [];
  for (const { adapter, settled: now } of read) {
    if (now === undefined || now.ok) {
      settled.push(now?.adapter ?? adapter);
    } else if (isWanted(adapter.descriptor, config)) {
      return { error: now.message, ok: false };
    } else {
      settled.push(adapter);
    }
  }
  return { adapters: settled, ok: true };
};
