import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { ResultSchema } from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { renderHuman } from "../src/render/human.ts";
import { factSteps } from "../src/runner/facts.ts";
import { runPlan } from "../src/runner/run.ts";
import { fakeAdapter } from "./fake-adapter.ts";

test("settings verification limits remain visible in normal check results", async () => {
  const adapter = fakeAdapter({
    descriptor: { reports: ["line_width"] },
    facts: () =>
      Promise.resolve({
        facts: [],
        limitations: ["The engine cannot expose resolved options"],
        ok: true,
      }),
  });
  const plan = resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: [adapter.descriptor],
    packages: [],
    paths: ["a.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  const result = await runPlan(plan, [adapter], {
    mode: "check",
    platform: "linux",
  });
  expect(result.notices).toEqual([
    "fake-tool settings: The engine cannot expose resolved options",
  ]);
  expect(renderHuman(result)).toContain(
    "The engine cannot expose resolved options"
  );
  const serialized = JSON.stringify(result);
  expect(ResultSchema.parse(JSON.parse(serialized)).notices).toEqual(
    result.notices
  );
  expect(adapter.calls.filter((call) => call === "facts")).toHaveLength(1);
});

test("shared config drift is reported once without losing per-file evidence", () => {
  const fact = {
    file: "formatter.json",
    key: "printWidth",
    name: "line_width",
    value: 120,
  };
  const observations = [
    {
      adapter: "fake",
      facts: [
        ...Array.from({ length: 32 }, (_, index) => ({
          ...fact,
          path: `src/file-${index}.ts`,
        })),
        { ...fact, file: "nested/formatter.json", path: "nested/a.ts" },
      ],
      limitations: [],
      tool: "fake-tool",
    },
  ];
  const steps = factSteps(
    {
      reporters: [],
      stated: [
        { ...fact, file: "rope.toml", key: "editor.line_width", value: 100 },
      ],
    },
    observations
  );
  expect(steps).toHaveLength(2);
  expect(steps.map((step) => step.path)).toEqual([
    "formatter.json",
    "nested/formatter.json",
  ]);
  expect(observations[0]?.facts).toHaveLength(33);
});
