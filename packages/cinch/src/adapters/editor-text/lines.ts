import type { EditorFacts } from "../../contracts/editor.ts";

export interface Problem {
  readonly setting: keyof EditorFacts;
  readonly message: string;
  readonly line: number;
}

/** Display columns, expanding tabs to the next configured tab stop. */
export const columns = (text: string, tabWidth: number): number => {
  let column = 0;
  for (const [index, part] of text.split("\t").entries()) {
    if (index > 0) {
      column += tabWidth - (column % tabWidth);
    }
    column += Bun.stringWidth(part, { countAnsiEscapeCodes: true });
  }
  return column;
};

const indentProblems = (
  line: string,
  facts: EditorFacts
): (keyof EditorFacts)[] => {
  const indent = /^[ \t]*/u.exec(line)?.[0] ?? "";
  if (line.trim() === "") {
    return [];
  }
  const problems: (keyof EditorFacts)[] = [];
  if (
    (facts.indent_style === "space" && indent.includes("\t")) ||
    (facts.indent_style === "tab" && indent.includes(" "))
  ) {
    problems.push("indent_style");
  }
  if (
    facts.indent_size !== undefined &&
    columns(indent, facts.indent_size) % facts.indent_size !== 0
  ) {
    problems.push("indent_size");
  }
  return problems;
};

/** Check all logical CR, LF and CRLF lines, including lines of unbounded length. */
export const checkLines = (text: string, facts: EditorFacts): Problem[] => {
  const problems: Problem[] = [];
  const endings = [...text.matchAll(/\r\n|\r|\n/gu)];
  const expected = { cr: "\r", crlf: "\r\n", lf: "\n" }[
    facts.end_of_line ?? "lf"
  ];
  if (
    facts.end_of_line !== undefined &&
    endings.some((ending) => ending[0] !== expected)
  ) {
    problems.push({
      line: 1,
      message: `use ${facts.end_of_line} line endings`,
      setting: "end_of_line",
    });
  }
  const final = /(?:\r\n|\r|\n)$/u.test(text);
  if (
    text !== "" &&
    facts.final_newline !== undefined &&
    final !== facts.final_newline
  ) {
    problems.push({
      line: 1,
      message: facts.final_newline
        ? "add a final newline"
        : "remove the final newline",
      setting: "final_newline",
    });
  }
  for (const [index, line] of text.split(/\r\n|\r|\n/u).entries()) {
    for (const setting of indentProblems(line, facts)) {
      problems.push({
        line: index + 1,
        message: `use the declared ${setting}`,
        setting,
      });
    }
    if (facts.trim_trailing_whitespace === true && /[^\S\r\n]+$/u.test(line)) {
      problems.push({
        line: index + 1,
        message: "remove trailing whitespace",
        setting: "trim_trailing_whitespace",
      });
    }
    if (
      facts.line_width !== undefined &&
      columns(line, facts.indent_size ?? 8) > facts.line_width
    ) {
      problems.push({
        line: index + 1,
        message: `keep the line within ${facts.line_width} display columns`,
        setting: "line_width",
      });
    }
  }
  return problems;
};
