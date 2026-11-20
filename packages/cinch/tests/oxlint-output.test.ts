import { expect, test } from "bun:test";

import { parseOutput } from "../src/adapters/oxlint/output.ts";

const FILE = "src/a.ts";
const read = (stdout: string, paths: readonly string[] = [FILE]) =>
  parseOutput(stdout, { paths, source: "oxlint" });
const report = (diagnostics: readonly unknown[], files = 1) =>
  JSON.stringify({ diagnostics, number_of_files: files });

test("maps a diagnostic into a finding with the rule id kept", () => {
  const run = read(
    report([
      {
        code: "eslint(no-var)",
        filename: FILE,
        labels: [{ span: { column: 5, length: 3, line: 2, offset: 9 } }],
        message: "Unexpected var, use let or const instead.",
        severity: "error",
      },
      {
        code: "eslint(no-console)",
        filename: FILE,
        labels: [{ span: { column: 1, length: 3, line: 4, offset: 30 } }],
        message: "Unexpected console statement.",
        severity: "warning",
      },
    ])
  );
  expect(run).toMatchObject({ linted: 1, ok: true });
  expect(run.ok ? run.files.get(FILE) : []).toEqual([
    {
      fixable: false,
      message: "Unexpected var, use let or const instead.",
      path: FILE,
      range: { start: { column: 5, line: 2 } },
      rule: "eslint(no-var)",
      severity: "error",
      source: "oxlint",
    },
    {
      fixable: false,
      message: "Unexpected console statement.",
      path: FILE,
      range: { start: { column: 1, line: 4 } },
      rule: "eslint(no-console)",
      severity: "warning",
      source: "oxlint",
    },
  ]);
});

test("files a diagnostic without a code or a place as a syntax problem at the top", () => {
  const run = read(
    report([{ filename: FILE, message: "Unexpected token", severity: "error" }])
  );
  expect(run.ok ? run.files.get(FILE) : []).toMatchObject([
    { range: { start: { column: 1, line: 1 } }, rule: "syntax" },
  ]);
});

test("gives every file it was handed an entry, and the count the run states", () => {
  const run = read(report([], 1), [FILE, "src/b.ts"]);
  expect(run).toMatchObject({ linted: 1, ok: true });
  expect(run.ok ? [...run.files.keys()] : []).toEqual([FILE, "src/b.ts"]);
});

test("reads the report after a note printed before it", () => {
  expect(read(`No files found to lint.\n${report([], 0)}`)).toMatchObject({
    linted: 0,
    ok: true,
  });
});

test("does not use a report it cannot read", () => {
  expect(read("")).toMatchObject({ ok: false });
  expect(read("{ not json")).toMatchObject({ ok: false });
  expect(read(JSON.stringify({ diagnostics: [] }))).toMatchObject({
    ok: false,
  });
});

test("does not drop a diagnostic for a file the run was not given", () => {
  const run = read(
    report([{ filename: "src/other.ts", message: "x", severity: "error" }])
  );
  expect(run).toEqual({
    message: "oxlint reported src/other.ts, which it was not given",
    ok: false,
  });
});
