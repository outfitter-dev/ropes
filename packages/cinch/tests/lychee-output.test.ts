import { expect, test } from "bun:test";

import { readOutput } from "../src/adapters/lychee/output.ts";

const input = { package: ".", paths: ["README.md"], root: "/repo" };
const base = {
  cached: 0,
  error_map: {},
  errors: 0,
  excluded_map: {},
  timeouts: 0,
  unknown: 0,
  unsupported: 0,
};

test("unusable or incomplete link reports cannot become a pass", () => {
  expect(readOutput("not JSON", input).ok).toBe(false);
  expect(readOutput(JSON.stringify(base), input).ok).toBe(true);
  expect(readOutput(JSON.stringify({ ...base, errors: 1 }), input).ok).toBe(
    false
  );
  expect(
    readOutput(JSON.stringify({ ...base, unsupported: 1 }), input).ok
  ).toBe(false);
  expect(
    readOutput(
      JSON.stringify({
        ...base,
        excluded_map: { "README.md": [{ url: "file:///repo/hidden.md" }] },
      }),
      input
    ).ok
  ).toBe(false);
});
