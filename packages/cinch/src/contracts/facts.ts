import { z } from "zod";

export const FactValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type FactValue = z.infer<typeof FactValueSchema>;

/**
 * One value of a shared fact, and the setting that states it. The name is
 * the one the `[editor]` table uses, such as `line_width`, whatever the tool
 * that reads the setting calls it.
 */
export const FactSchema = z
  .object({
    /** Root-relative file that states the value. */
    file: z.string().min(1),
    /** The setting inside that file, in that file's own words. */
    key: z.string().min(1),
    name: z.string().min(1),
    value: FactValueSchema,
  })
  .readonly();
export type Fact = z.infer<typeof FactSchema>;

/** An adapter whose tool has settings of its own for shared facts. */
export const FactReporterSchema = z
  .object({
    adapter: z.string().min(1),
    /** The facts it can report. Empty when it cannot report any. */
    reports: z.array(z.string().min(1)).readonly(),
    tool: z.string().min(1),
  })
  .readonly();
export type FactReporter = z.infer<typeof FactReporterSchema>;

/**
 * Provisional and unstable. What a run compares besides checking files: the
 * facts the Cinch config states, and the adapters asked what their tools
 * resolve for the same facts.
 */
export const SharedFactsSchema = z
  .object({
    reporters: z.array(FactReporterSchema).readonly(),
    stated: z.array(FactSchema).readonly(),
  })
  .readonly();
export type SharedFacts = z.infer<typeof SharedFactsSchema>;

/**
 * What an adapter found its tool resolves. Only values a file sets are
 * reported: a tool's built-in default is not a statement anyone made.
 */
export type FactReport =
  | { readonly ok: true; readonly facts: readonly Fact[] }
  | { readonly ok: false; readonly reason: string };
