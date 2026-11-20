import { z } from "zod";

const facts = {
  charset: z
    .enum(["latin1", "utf-16be", "utf-16le", "utf-8", "utf-8-bom"])
    .optional()
    .describe("The character set of text files."),
  end_of_line: z
    .enum(["cr", "crlf", "lf"])
    .optional()
    .describe("How a line ends."),
  final_newline: z
    .boolean()
    .optional()
    .describe("Whether a file ends with a newline."),
  indent_size: z
    .int()
    .min(1)
    .max(16)
    .optional()
    .describe("How many columns one level of indent takes."),
  indent_style: z
    .enum(["space", "tab"])
    .optional()
    .describe("Whether indents are spaces or tabs."),
  line_width: z
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("The column a line should not run past."),
  trim_trailing_whitespace: z
    .boolean()
    .optional()
    .describe("Whether whitespace at the end of a line is removed."),
};

/** A glob may not hold what would end or reopen a section header. */
const FileGlob = z
  .string()
  .min(1)
  .regex(/^[^\n\r\u005B\u005D#;]+$/u, "a glob here cannot hold [, ], # or ;");

const OverrideSchema = z.strictObject({
  ...facts,
  files: z
    .array(FileGlob)
    .min(1)
    .describe("The globs these facts apply to, such as `Makefile`."),
});

/**
 * Provisional and unstable. The `[editor]` table of the Cinch config: the
 * facts about text files that several tools have to agree on. They are
 * stated once, and Cinch writes them where each tool reads them.
 */
export const EditorSchema = z.strictObject({
  ...facts,
  overrides: z
    .array(OverrideSchema)
    .optional()
    .describe("Facts for some files. A later entry wins over an earlier."),
});
export type EditorSettings = z.infer<typeof EditorSchema>;
export type EditorOverride = z.infer<typeof OverrideSchema>;
/** The facts alone, as the base table or one override states them. */
export type EditorFacts = Omit<EditorOverride, "files">;
