import { expect, test } from "bun:test";

import { readOutput } from "../src/adapters/editorconfig/check-output.ts";

const diagnostic = (description: string, begin = 1, end = begin) => ({
  check_name: "editorconfig-checker",
  description,
  location: { lines: { begin, end }, path: "a.txt" },
});

test("native editor findings keep ranges and identify each declared setting", () => {
  const output = readOutput(
    JSON.stringify([
      diagnostic(
        "wrong amount of left-padding spaces(want multiple of 2)",
        3,
        5
      ),
      diagnostic("not all lines have the correct end of line character", -1),
      diagnostic("line too long (81 instead of 80)", 2),
      diagnostic('wrong character encoding ("latin1" instead of "utf-8")', -1),
    ]),
    "a.txt"
  );
  expect(output.map((finding) => finding.rule)).toEqual([
    "indent_size",
    "end_of_line",
    "line_width",
    "charset",
  ]);
  expect(output[0]?.range).toEqual({
    end: { column: 1, line: 5 },
    start: { column: 1, line: 3 },
  });
  expect(output[1]?.range.start.line).toBe(1);
});

test("warnings, unknown native messages and unselected source paths are rejected", () => {
  expect(() => readOutput("warning\n[]", "a.txt")).toThrow();
  expect(() =>
    readOutput(JSON.stringify([diagnostic("new native warning")]), "a.txt")
  ).toThrow();
  expect(() =>
    readOutput(JSON.stringify([diagnostic("trailing whitespace")]), "other.txt")
  ).toThrow();
});
