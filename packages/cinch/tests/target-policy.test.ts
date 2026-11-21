import { expect, test } from "bun:test";

import { compilerApiAdapter } from "../src/adapters/bun-check/compatibility.ts";
import { targetDecision } from "../src/policy/targets.ts";

const { descriptor } = compilerApiAdapter();

const decision = (range: string) =>
  targetDecision(descriptor, "pkg", [
    {
      dependency: "typescript",
      package: "pkg",
      range,
      source: {
        file: "pkg/package.json",
        key: "peerDependencies.typescript",
      },
      state: "declared",
    },
  ]);

test("support ranges must establish a single side of the declared threshold", () => {
  expect(decision("4.9.5")?.decision).toBe("inapplicable");
  expect(decision("^4.9.0")?.decision).toBe("inapplicable");
  expect(decision("5.0.0")?.decision).toBe("applicable");
  expect(decision("^5.0.0")?.decision).toBe("applicable");
  expect(decision("^4.9.0 || ^5.0.0")?.decision).toBe("unresolved");
  expect(decision("*")?.decision).toBe("unresolved");
  expect(decision(">=6.0.0 <5.0.0")?.decision).toBe("unresolved");
  expect(decision("workspace:*")?.decision).toBe("unresolved");
  expect(decision("5.0.0-beta.1")?.decision).toBe("unresolved");
});
