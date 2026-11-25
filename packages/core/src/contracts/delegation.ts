import { z } from "zod";

const SourceSchema = z
  .object({
    file: z.string().min(1),
    key: z.string().min(1),
    kind: z.literal("file"),
  })
  .readonly();

/** Policy domains a repository can hand to another tool. */
export const DomainSchema = z.enum([
  "markdown",
  "toml",
  "lint",
  "format",
  "typescript",
  "rules",
  "editor",
  "install",
]);
export type Domain = z.infer<typeof DomainSchema>;

/** The external owner of a selected path's domains. This is scope, never a verdict. */
export const DelegatedSchema = z
  .object({
    domains: z.array(DomainSchema).min(1).readonly(),
    source: SourceSchema,
    tool: z.string().min(1),
  })
  .readonly();
export type Delegated = z.infer<typeof DelegatedSchema>;

export const ProtectedSchema = z
  .object({
    source: SourceSchema,
    tool: z.string().min(1),
  })
  .readonly();

export type Protected = z.infer<typeof ProtectedSchema>;
