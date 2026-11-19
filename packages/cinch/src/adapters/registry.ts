import type { Adapter } from "./adapter.ts";

/**
 * The only place adapters are listed. Adding an engine is one new folder under
 * `adapters/` and one line here. The first two are rumdl (FIT-12) and the Bun
 * formatter for fences (FIT-13).
 */
export const adapters: readonly Adapter[] = [];
