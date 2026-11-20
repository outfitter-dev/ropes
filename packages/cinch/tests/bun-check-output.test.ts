import { expect, test } from "bun:test";

import { parseOutput, summaryOf } from "../src/adapters/bun-check/output.ts";

test("the printed errors are read with the lines that continue them", () => {
  const parsed = parseOutput(
    [
      "error TS6053: File '/r/gone.ts' not found.",
      "src/y.ts(4,14): error TS2322: Type 'B' is not assignable to type 'A'.",
      "  The types of 'a.b.c' are incompatible between these types.",
      "    Type 'string' is not assignable to type 'number'.",
      "",
    ].join("\n"),
    "bun-check"
  );
  expect(parsed).toMatchObject({
    global: ["File '/r/gone.ts' not found."],
    located: [
      {
        message:
          "Type 'B' is not assignable to type 'A'. The types of 'a.b.c' are incompatible between these types. Type 'string' is not assignable to type 'number'.",
        path: "src/y.ts",
        range: { start: { column: 14, line: 4 } },
        rule: "TS2322",
      },
    ],
    ok: true,
  });
  expect(parseOutput("something else\n", "bun-check")).toEqual({
    message: "it printed a line that is no error: something else",
    ok: false,
  });
});

test("the summary says how many errors there were and whether it stopped", () => {
  expect(summaryOf("✓ No type errors in 1 file [30.69ms]\n")).toEqual({
    clean: true,
    stopped: false,
  });
  expect(
    summaryOf(
      "note: Stopped before type checking 1 file. Fix the errors above to see the rest.\nFound 1 error in 1 file, checked 0 files [55.59ms]\n"
    )
  ).toEqual({ clean: false, found: 1, stopped: true });
});

const ERROR =
  "a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.";
const ANNOTATED =
  "::error file=a.ts,line=1,col=14,endLine=1,endColumn=15,title=TS2322::Type 'string' is not assignable to type 'number'.";

test("the annotations GitHub Actions adds repeat the errors and are passed over", () => {
  const parsed = parseOutput(
    [
      "error TS6053: File '/r/gone.ts' not found.",
      ERROR,
      "::error title=TS6053::File '/r/gone.ts' not found.",
      ANNOTATED,
      "",
    ].join("\n"),
    "bun-check"
  );
  expect(parsed).toMatchObject({
    global: ["File '/r/gone.ts' not found."],
    located: [{ path: "a.ts", rule: "TS2322" }],
    ok: true,
  });
});

test("annotations that do not match the errors make the output unusable", () => {
  expect(parseOutput(`${ERROR}\n${ANNOTATED}\n${ANNOTATED}\n`, "s")).toEqual({
    message: "it printed 1 errors and 2 annotations for them",
    ok: false,
  });
  expect(parseOutput(`${ANNOTATED}\n`, "s").ok).toBe(false);
});
