import { expect, test } from "bun:test";

import {
  configProblem,
  parseOutput,
  readOnly,
} from "../src/adapters/taplo/output.ts";

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

const collected = (total: number, excluded: number, files: string) =>
  ` INFO x: found files total=${total} excluded=${excluded} files=[${files}] cwd="/repo"\n`;

test("only the one file asked for counts as read", () => {
  expect(readOnly(SYNTAX, "mise.toml")).toBe(true);
  expect(readOnly(SYNTAX, "other.toml")).toBe(false);
  expect(readOnly(collected(1, 1, ""), "mise.toml")).toBe(false);
  expect(readOnly(collected(0, 0, ""), "mise.toml")).toBe(false);
  expect(readOnly("", "mise.toml")).toBeUndefined();
});

const CONFLICT = `${collected(1, 0, '"/repo/a.toml"')}error: conflicting keys
  ┌─ /repo/a.toml:2:1
  │
1 │ a = 1
  │ - duplicate found here
2 │ a = 2
  │ ^ duplicate key

ERROR taplo:lint_files: invalid file error=semantic errors found path="/repo/a.toml"
`;

test("keys that conflict are a syntax finding, with no schema involved", () => {
  const parsed = parseOutput(CONFLICT, { path: "a.toml", source: "taplo" });
  expect(parsed).toMatchObject({
    findings: [{ message: "conflicting keys", rule: "syntax" }],
    ok: true,
  });
});

test("a config the engine refused is named, and a usable one is not", () => {
  const refused = ` INFO taplo:load_config: found configuration file path="/repo/.taplo.toml"
 WARN taplo:load_config: invalid configuration file error=TOML parse error at line 1, column 11
`;
  expect(configProblem(refused)).toContain("invalid configuration file");
  expect(configProblem(SYNTAX)).toBeUndefined();
});
