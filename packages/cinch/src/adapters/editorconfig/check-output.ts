import { z } from "zod";

import type { Finding } from "../../contracts/finding.ts";

const IssueSchema = z.object({
  check_name: z.literal("editorconfig-checker"),
  description: z.string().min(1),
  location: z.object({
    lines: z.object({ begin: z.int(), end: z.int() }),
    path: z.string().min(1),
  }),
});
const OutputSchema = z.array(IssueSchema);

/** Native v4.0.2 messages, named after the shared editor fact they enforce. */
const settingOf = (message: string): string | undefined => {
  if (
    message.includes("indent style") ||
    message.includes("indentation type")
  ) {
    return "indent_style";
  }
  if (message.startsWith("wrong amount of left-padding")) {
    return "indent_size";
  }
  if (message === "trailing whitespace") {
    return "trim_trailing_whitespace";
  }
  if (message === "not all lines have the correct end of line character") {
    return "end_of_line";
  }
  if (message.includes("final newline")) {
    return "final_newline";
  }
  if (message.startsWith("line too long")) {
    return "line_width";
  }
  if (message.startsWith("wrong character encoding")) {
    return "charset";
  }
  return undefined;
};

/** Reject native warnings and unfamiliar messages instead of claiming coverage. */
export const readOutput = (stdout: string, file: string): Finding[] => {
  const issues = OutputSchema.parse(
    stdout.trim() === "" ? [] : JSON.parse(stdout)
  );
  return issues.map((issue) => {
    const setting = settingOf(issue.description);
    if (issue.location.path !== file || setting === undefined) {
      throw new Error("the editor checker returned an unexpected finding");
    }
    const start = Math.max(1, issue.location.lines.begin);
    return {
      fixable: false,
      message: `[editor] ${setting}: ${issue.description}`,
      path: file,
      range: {
        end: { column: 1, line: Math.max(start, issue.location.lines.end) },
        start: { column: 1, line: start },
      },
      rule: setting,
      severity: "error",
      source: "editorconfig-checker",
    };
  });
};
