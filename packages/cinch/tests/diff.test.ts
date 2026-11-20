import { expect, test } from "bun:test";

import { changeAt, unifiedDiff } from "../src/render/diff.ts";

const lines = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`);
const text = (list: readonly string[]): string => `${list.join("\n")}\n`;

test("the same text has no diff", () => {
  expect(unifiedDiff("a.md", "x\n", "x\n")).toBe("");
});

test("distant changes get separate hunks with three lines of context", () => {
  const before = lines(20);
  const after = before.with(1, "changed 2").with(17, "changed 18");
  expect(unifiedDiff("a.md", text(before), text(after))).toBe(
    [
      "--- a/a.md",
      "+++ b/a.md",
      "@@ -1,5 +1,5 @@",
      " line 1",
      "-line 2",
      "+changed 2",
      " line 3",
      " line 4",
      " line 5",
      "@@ -15,6 +15,6 @@",
      " line 15",
      " line 16",
      " line 17",
      "-line 18",
      "+changed 18",
      " line 19",
      " line 20",
      "",
    ].join("\n")
  );
});

test("an insertion and a deletion shift the line numbers", () => {
  const before = lines(6);
  const after = ["new", ...before.slice(0, 5)];
  expect(unifiedDiff("a.md", text(before), text(after))).toBe(
    "--- a/a.md\n+++ b/a.md\n@@ -1,6 +1,6 @@\n+new\n line 1\n line 2\n line 3\n line 4\n line 5\n-line 6\n"
  );
});

test("a file that gains its first lines starts the old side at 0", () => {
  expect(unifiedDiff("a.md", "", "one\n")).toBe(
    "--- a/a.md\n+++ b/a.md\n@@ -0,0 +1,1 @@\n+one\n"
  );
});

test("adding the final newline is a change", () => {
  expect(unifiedDiff("a.md", "one", "one\n")).toBe(
    "--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n-one\n\\ No newline at end of file\n+one\n"
  );
});

test("a path that would break the header is quoted the way git quotes it", () => {
  expect(unifiedDiff('a\tb "c".md', "x\n", "y\n")).toStartWith(
    '--- "a/a\\tb \\"c\\".md"\n+++ "b/a\\tb \\"c\\".md"\n@@'
  );
});

test("the change at a span of lines is only the hunks that touch it", () => {
  const before = lines(20);
  const after = before.with(1, "changed 2").with(17, "changed 18");
  const at = (from: number, to = from) =>
    changeAt("a.md", text(before), text(after), { from, to });
  expect(at(18)).toBe(
    [
      "--- a/a.md",
      "+++ b/a.md",
      "@@ -15,6 +15,6 @@",
      " line 15",
      " line 16",
      " line 17",
      "-line 18",
      "+changed 18",
      " line 19",
      " line 20",
      "",
    ].join("\n")
  );
  expect(at(1, 2)).toContain("+changed 2");
  expect(at(1, 2)).not.toContain("changed 18");
  // Context lines of a hunk are not lines the change touched.
  expect(at(3, 17)).toBe("");
});

test("a removed line counts as the line that took its place", () => {
  const before = lines(6);
  const after = before.toSpliced(2, 1);
  const at = (line: number) =>
    changeAt("a.md", text(before), text(after), { from: line, to: line });
  expect(at(3)).toContain("-line 3");
  expect(at(2)).toBe("");
});

test("a line removed from the end counts as the last line left", () => {
  const before = lines(6);
  const after = before.slice(0, 4);
  const at = (line: number) =>
    changeAt("a.md", text(before), text(after), { from: line, to: line });
  expect(at(4)).toContain("-line 6");
  expect(at(3)).toBe("");
  expect(changeAt("a.md", "only\n", "", { from: 1, to: 1 })).toContain("-only");
});
