import { expect, test } from "bun:test";

import { filesRead, parseOutput } from "../src/adapters/taplo/output.ts";

const CONTEXT = { path: "mise.toml", source: "taplo" };

const SYNTAX = ` INFO taplo:lint_files:collect_files: found files total=1 excluded=0 files=["/repo/mise.toml"] cwd="/repo"
error: invalid TOML
  ┌─ /repo/mise.toml:2:5
  │  
2 │   b = 
  │ ╭────^
3 │ │ c = [1,
  │ ╰^ expected value

error: invalid TOML
  ┌─ /repo/mise.toml:4:2
  │
4 │ [x]
  │  ^ expected ","

ERROR taplo:lint_files: invalid file error=syntax errors found path="/repo/mise.toml"
`;

const SCHEMA = ` INFO taplo:lint_files:collect_files: found files total=1 excluded=0 files=["/repo/cinch.toml"] cwd="/repo"
error: Additional properties are not allowed ('nope' was unexpected)
  ┌─ /repo/cinch.toml:2:8
  │
2 │ nope = 1
  │        ^ Additional properties are not allowed ('nope' was unexpected)

ERROR taplo:lint_files: invalid file error=schema validation failed path="/repo/cinch.toml"
ERROR operation failed error=some files were not valid
`;

test("a document that does not parse gives one syntax finding per problem", () => {
  expect(parseOutput(SYNTAX, CONTEXT)).toEqual({
    findings: [
      {
        fixable: false,
        message: "invalid TOML: expected value",
        path: "mise.toml",
        range: { start: { column: 5, line: 2 } },
        rule: "syntax",
        severity: "error",
        source: "taplo",
      },
      {
        fixable: false,
        message: 'invalid TOML: expected ","',
        path: "mise.toml",
        range: { start: { column: 2, line: 4 } },
        rule: "syntax",
        severity: "error",
        source: "taplo",
      },
    ],
    ok: true,
  });
});

test("a value the schema refuses is a schema finding with the schema's words", () => {
  expect(parseOutput(SCHEMA, { ...CONTEXT, path: "cinch.toml" })).toEqual({
    findings: [
      {
        fixable: false,
        message:
          "Additional properties are not allowed ('nope' was unexpected)",
        path: "cinch.toml",
        range: { start: { column: 8, line: 2 } },
        rule: "schema",
        severity: "error",
        source: "taplo",
      },
    ],
    ok: true,
  });
});

test("a problem with no place makes the output unusable", () => {
  expect(parseOutput("error: something went wrong\n", CONTEXT)).toEqual({
    message: 'it gave no place for "something went wrong"',
    ok: false,
  });
});

test("clean output has no findings", () => {
  expect(
    parseOutput(" INFO found files total=1 excluded=0\n", CONTEXT)
  ).toEqual({
    findings: [],
    ok: true,
  });
});

test("the number of files read comes from the log, or is unknown", () => {
  expect(filesRead(SYNTAX)).toBe(1);
  expect(filesRead(" INFO x: found files total=1 excluded=1\n")).toBe(0);
  expect(filesRead(" INFO x: found files total=0 excluded=0\n")).toBe(0);
  expect(filesRead("")).toBeUndefined();
});
