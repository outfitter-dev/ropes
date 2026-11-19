import { expect, test } from "bun:test";

import {
  parseFinding,
  parsePlan,
  parseResult,
} from "../src/contracts/parse.ts";
import { outcomeOf } from "../src/contracts/result.ts";

const fixture = (name: string): Promise<Record<string, unknown>> =>
  Bun.file(new URL(`fixtures/${name}.json`, import.meta.url)).json();

type Status = "passed" | "findings" | "fixed" | "incomplete";
const step = (status: Status) => ({
  adapter: "fake",
  findings: [],
  path: "a.md",
  status,
});

const [finding, plan, result] = await Promise.all([
  fixture("finding"),
  fixture("plan"),
  fixture("result"),
]);

test("the golden fixtures parse and come back unchanged", () => {
  const parsed: unknown[] = [
    parseFinding(finding),
    parsePlan(plan),
    parseResult(result),
  ];
  expect(parsed).toEqual([
    { ok: true, value: finding },
    { ok: true, value: plan },
    { ok: true, value: result },
  ]);
});

test("an unknown schema version is an error, never a guess", () => {
  for (const parse of [parsePlan, parseResult]) {
    expect(parse({ ...plan, schemaVersion: 99 })).toEqual({
      error: { found: 99, kind: "unknown-version" },
      ok: false,
    });
  }
});

test("a missing schema version is invalid", () => {
  const parsed = parsePlan({ paths: [], root: "/repo" });
  expect(parsed.ok).toBe(false);
  expect(parsed.ok ? "" : parsed.error.kind).toBe("invalid");
});

test("a malformed document reports where it went wrong", () => {
  const parsed = parseFinding({ ...finding, severity: "fatal" });
  expect(parsed.ok ? [] : parsed.error).toMatchObject({ kind: "invalid" });
  expect(JSON.stringify(parsed)).toContain("severity");
});

test("a result whose outcome contradicts its steps is invalid", () => {
  for (const outcome of ["clean", "findings"]) {
    const parsed = parseResult({ ...result, outcome });
    expect(parsed.ok ? [] : parsed.error).toMatchObject({ kind: "invalid" });
    expect(JSON.stringify(parsed)).toContain("outcome");
  }
});

test("every step in the result fixture is a step its plan schedules", () => {
  const parsed = parseResult(result);
  if (!parsed.ok) {
    throw new Error("the result fixture did not parse");
  }
  const planned = new Set(
    parsed.value.plan.paths.flatMap((entry) =>
      entry.steps.map((planStep) => `${entry.path}:${planStep.adapter}`)
    )
  );
  for (const ran of parsed.value.steps) {
    expect(planned.has(`${ran.path}:${ran.adapter}`)).toBe(true);
  }
});

test("incomplete beats findings, and findings beat clean", () => {
  expect(outcomeOf([])).toBe("clean");
  expect(outcomeOf([step("passed"), step("fixed")])).toBe("clean");
  expect(outcomeOf([step("passed"), step("findings")])).toBe("findings");
  expect(outcomeOf([step("findings"), step("incomplete")])).toBe("incomplete");
});
