import type { Adapter } from "./adapter.ts";

/**
 * Folders of rules an adapter found named in its engine's own project
 * config, with the root-relative file and the key that name them.
 */
export interface FoundRules {
  readonly file: string;
  readonly key: string;
  readonly folders: readonly string[];
}

/** An adapter once it has read what the repository says to its engine. */
export type Settled =
  | { readonly ok: true; readonly adapter: Adapter }
  | { readonly ok: false; readonly message: string };
