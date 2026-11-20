import { expect, test } from "bun:test";

import { parseOutput } from "../src/adapters/rumdl/output.ts";

const FILE = "docs/a.md";
/** What one run says about the one file it was given. */
const parseOne = (stdout: string) => {
  const run = parseOutput(stdout, { paths: [FILE], source: "rumdl" });
  return run.ok ? run.files.get(FILE) : run;
};
const fixture = await Bun.file(
  new URL("fixtures/rumdl/output.json", import.meta.url)
).text();

test("maps what rumdl prints into findings", () => {
  expect(parseOne(fixture)).toEqual({
    findings: [
      {
        fixable: true,
        message: "Multiple top-level headings (level 1) in the same document",
        path: "docs/a.md",
        range: { start: { column: 3, line: 3 } },
        rule: "MD025",
        severity: "error",
        source: "rumdl",
      },
      {
        fixable: false,
        message: "Inline HTML found: <b>",
        path: "docs/a.md",
        range: { start: { column: 1, line: 7 } },
        rule: "MD033",
        severity: "warning",
        source: "rumdl",
      },
    ],
    ok: true,
  });
});

test("a severity below warning is reported as a warning", () => {
  const entry = {
    column: 1,
    file: FILE,
    fixable: false,
    line: 1,
    message: "m",
    rule: "R",
  };
  const parsed = parseOne(JSON.stringify([{ ...entry, severity: "info" }]));
  expect(parsed?.ok === true ? parsed.findings[0]?.severity : "").toBe(
    "warning"
  );
});

test("an empty array is no findings", () => {
  expect(parseOne("[]")).toEqual({ findings: [], ok: true });
});

test("output that is not JSON, or not the expected shape, is an error", () => {
  expect(parseOne("Success: No issues found")?.ok).toBe(false);
  expect(parseOne('{"file":"a.md"}')?.ok).toBe(false);
  expect(parseOne('[{"line":0,"column":1}]')?.ok).toBe(false);
});

test("a fenced block a tool could not handle makes the output unusable", () => {
  const stopped = JSON.stringify([
    {
      column: 1,
      file: FILE,
      fixable: false,
      line: 3,
      message: "Tool 'bun' failed: Exit code 2: error: '}' expected.\n  at 2:1",
      rule: "code-block-tools",
      severity: "error",
    },
  ]);
  expect(parseOne(stopped)).toEqual({
    message:
      "it could not check the fenced block at line 3: Tool 'bun' failed: Exit code 2: error: '}' expected.",
    ok: false,
  });
});

test("each file of a run gets its own findings, and a clean one has none", () => {
  const entry = { column: 1, fixable: false, line: 1, message: "m" };
  const stdout = JSON.stringify([
    { ...entry, file: "a.md", rule: "MD001", severity: "warning" },
    { ...entry, file: "b.md", rule: "code-block-tools", severity: "error" },
  ]);
  const run = parseOutput(stdout, {
    paths: ["a.md", "b.md", "c.md"],
    source: "rumdl",
  });
  const files = run.ok ? run.files : new Map();
  expect(files.get("a.md")).toMatchObject({
    findings: [{ path: "a.md", rule: "MD001" }],
    ok: true,
  });
  expect(files.get("b.md")).toMatchObject({ ok: false });
  expect(files.get("c.md")).toEqual({ findings: [], ok: true });
});

test("a finding in a file the run was not given spoils the run", () => {
  const stdout = JSON.stringify([
    {
      column: 1,
      file: "other.md",
      fixable: false,
      line: 1,
      message: "m",
      rule: "R",
      severity: "warning",
    },
  ]);
  expect(parseOne(stdout)).toEqual({
    message: "it reported on other.md, which it was not given",
    ok: false,
  });
});
