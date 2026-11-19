import { expect, test } from "bun:test";

import { parseOutput } from "../src/adapters/rumdl/output.ts";

const context = { path: "docs/a.md", source: "rumdl" };
const fixture = await Bun.file(
  new URL("fixtures/rumdl/output.json", import.meta.url)
).text();

test("maps what rumdl prints into findings", () => {
  expect(parseOutput(fixture, context)).toEqual({
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
  const entry = { column: 1, fixable: false, line: 1, message: "m", rule: "R" };
  const parsed = parseOutput(
    JSON.stringify([{ ...entry, severity: "info" }]),
    context
  );
  expect(parsed.ok ? parsed.findings[0]?.severity : "").toBe("warning");
});

test("an empty array is no findings", () => {
  expect(parseOutput("[]", context)).toEqual({ findings: [], ok: true });
});

test("output that is not JSON, or not the expected shape, is an error", () => {
  expect(parseOutput("Success: No issues found", context).ok).toBe(false);
  expect(parseOutput('{"file":"a.md"}', context).ok).toBe(false);
  expect(parseOutput('[{"line":0,"column":1}]', context).ok).toBe(false);
});

test("a fenced block a tool could not handle makes the output unusable", () => {
  const stopped = JSON.stringify([
    {
      column: 1,
      file: "a.md",
      fixable: false,
      line: 3,
      message: "Tool 'bun' failed: Exit code 2: error: '}' expected.\n  at 2:1",
      rule: "code-block-tools",
      severity: "error",
    },
  ]);
  expect(parseOutput(stopped, context)).toEqual({
    message:
      "it could not check the fenced block at line 3: Tool 'bun' failed: Exit code 2: error: '}' expected.",
    ok: false,
  });
});
