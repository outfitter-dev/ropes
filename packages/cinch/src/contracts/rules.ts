import { z } from "zod";

/** What a pack's `pack.toml` states. */
export const PackManifestSchema = z.strictObject({
  about: z.string().min(1),
  /** Requires adoption by name, including during initialization. */
  explicitOnly: z.boolean().optional(),
  name: z.string().min(1),
  /** Root-relative globs. The pack applies where a file matches one. */
  relevant: z.array(z.string().min(1)).min(1),
});

/**
 * A group of rules an adapter ships, and the files that make it worth
 * running. A rule id is `<pack>/<rule>`.
 */
export interface RulePack extends z.infer<typeof PackManifestSchema> {
  readonly rules: readonly string[];
}
