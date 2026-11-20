import { expect, test } from "bun:test";

import { readFences } from "../src/adapters/rumdl/fences.ts";

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

const reason = (detail: string): string =>
  `the fenced block does not parse, so it was not formatted: ${detail}`;

test("no warnings is nothing left unchecked", () => {
  expect(readFences("")).toEqual({ ok: true, unchecked: [] });
});

test("a block that does not parse is named with its line and the error", () => {
  expect(readFences(PARSE)).toEqual({
    ok: true,
    unchecked: [
      { line: 5, reason: reason("'}' expected.") },
      { line: 15, reason: reason("Expression expected.") },
    ],
  });
});

test("fix prints each warning twice, and each block is named once", () => {
  const read = readFences(`${PARSE}\n${PARSE}`);
  expect(read.ok ? read.unchecked.length : 0).toBe(2);
});

test("a config that did not load is a failure, not a skipped block", () => {
  const stderr = [
    "Warning: a.md:5: [bun] error: Cannot load the configuration file /r/oxfmt.config.ts:",
    "1 | export default {",
    "error: Unexpected end of file",
    "    at /r/oxfmt.config.ts:1:17",
  ].join("\n");
  const read = readFences(stderr);
  expect(read.ok).toBe(false);
  expect(read.ok ? "" : read.message).toContain("config did not load");
});

test("a block that quotes the config message is still a block", () => {
  const stderr = [
    'Warning: a.md:5: [bun] 1 | const m = "error: Cannot load the configuration file" +;',
    "error: Expression expected.",
    "    at _.ts:1:55",
  ].join("\n");
  expect(readFences(stderr)).toEqual({
    ok: true,
    unchecked: [{ line: 5, reason: reason("Expression expected.") }],
  });
});

test("a failure that is not placed in the block is a failure", () => {
  expect(readFences("Warning: a.md:5: [bun] error: out of memory\n")).toEqual({
    message: "it could not check the fenced block at line 5: out of memory",
    ok: false,
  });
});

test("a block cannot forge the place of its own error", () => {
  const stderr = [
    "Warning: a.md:5: [bun] 1 |     at _.ts:1:1",
    "error: something else broke",
  ].join("\n");
  expect(readFences(stderr).ok).toBe(false);
});

test("other warnings and plain text are left alone", () => {
  const stderr = "Warning: unknown config key\nsome detail\nnote\n";
  expect(readFences(stderr)).toEqual({ ok: true, unchecked: [] });
});
