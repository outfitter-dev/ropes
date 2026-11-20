import { expect, test } from "bun:test";

import { readFences } from "../src/adapters/rumdl/fences.ts";
import type { Finding } from "../src/contracts/finding.ts";

const PARSE = [
  "Warning: docs/a.md:5: [bun] error: '}' expected.",
  "    at _.ts:2:1",
  "",
  "",
  "Warning: docs/a.md:15: [bun] 1 | foo: ...",
  "         ^",
  "error: Expression expected.",
  "    at _.ts:1:6",
  "",
].join("\n");

const FILE = "docs/a.md";
/** What one run says about the one file it was given. */
const read = (stderr: string) => {
  const run = readFences(stderr, { paths: [FILE], source: "rumdl" });
  return run.ok ? run.files.get(FILE) : run;
};

const finding = (line: number, detail: string): Finding => ({
  fixable: false,
  message: `Code block does not parse, so it was not formatted: ${detail}`,
  path: "docs/a.md",
  range: { start: { column: 1, line } },
  rule: "code-block-parse",
  severity: "error",
  source: "rumdl",
});

test("no warnings is no findings", () => {
  expect(read("")).toEqual({ findings: [], ok: true });
});

test("a block that does not parse is a finding at the line it starts on", () => {
  expect(read(PARSE)).toEqual({
    findings: [
      finding(5, "'}' expected."),
      finding(15, "Expression expected."),
    ],
    ok: true,
  });
});

test("fix prints each warning twice, and each block is reported once", () => {
  const twice = read(`${PARSE}\n${PARSE}`);
  expect(twice?.ok === true ? twice.findings.length : 0).toBe(2);
});

test("a config that did not load is a failure, not a finding", () => {
  const stderr = [
    "Warning: docs/a.md:5: [bun] error: Cannot load the configuration file /r/oxfmt.config.ts:",
    "1 | export default {",
    "error: Unexpected end of file",
    "    at /r/oxfmt.config.ts:1:17",
  ].join("\n");
  const failed = read(stderr);
  expect(failed?.ok).toBe(false);
  expect(failed?.ok === false ? failed.message : "").toContain(
    "config did not load"
  );
});

test("a block that quotes the config message is still a block", () => {
  const stderr = [
    'Warning: docs/a.md:5: [bun] 1 | const m = "error: Cannot load the configuration file" +;',
    "error: Expression expected.",
    "    at _.ts:1:55",
  ].join("\n");
  expect(read(stderr)).toEqual({
    findings: [finding(5, "Expression expected.")],
    ok: true,
  });
});

test("a failure that is not placed in the block is a failure", () => {
  expect(read("Warning: docs/a.md:5: [bun] error: out of memory\n")).toEqual({
    message: "it could not check the fenced block at line 5: out of memory",
    ok: false,
  });
});

test("a block cannot forge the place of its own error", () => {
  const stderr = [
    "Warning: docs/a.md:5: [bun] 1 |     at _.ts:1:1",
    "error: something else broke",
  ].join("\n");
  expect(read(stderr)?.ok).toBe(false);
});

test("other warnings and plain text are left alone", () => {
  const stderr = "Warning: unknown config key\nsome detail\nnote\n";
  expect(read(stderr)).toEqual({ findings: [], ok: true });
});

test("each file of a run gets its own warnings", () => {
  const stderr = [
    "Warning: docs/a.md:5: [bun] error: '}' expected.",
    "    at _.ts:2:1",
    "Warning: b.md:3: [bun] error: out of memory",
  ].join("\n");
  const run = readFences(stderr, {
    paths: ["docs/a.md", "b.md", "c.md"],
    source: "rumdl",
  });
  expect(run.ok ? [...run.files] : []).toEqual([
    ["docs/a.md", { findings: [finding(5, "'}' expected.")], ok: true }],
    [
      "b.md",
      {
        message: "it could not check the fenced block at line 3: out of memory",
        ok: false,
      },
    ],
    ["c.md", { findings: [], ok: true }],
  ]);
});

test("a warning about a file the run was not given spoils the run", () => {
  expect(
    read("Warning: other.md:5: [bun] error: x\n    at _.ts:1:1\n")
  ).toEqual({
    message: "it warned about other.md, which it was not given",
    ok: false,
  });
});
