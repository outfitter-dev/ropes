import { expect, test } from "bun:test";

import { adaptersFor } from "../src/adapters/registry.ts";
import { parseConfigTable } from "../src/config/parse.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { resolvePlan } from "../src/policy/resolve.ts";

const descriptors = adaptersFor({}).map(({ descriptor }) => descriptor);
const resolve = (config = DEFAULT_CONFIG) =>
  resolvePlan({
    config,
    descriptors,
    packages: [],
    paths: ["index.md", "vendor/guide.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  });

test("default Markdown keeps its Windows-capable engines and links require adoption", () => {
  const plan = resolve();
  for (const entry of plan.paths) {
    expect(entry.steps.map((step) => step.adapter)).toEqual(["rumdl"]);
    expect(
      entry.steps.every(
        (step) =>
          descriptors
            .find((descriptor) => descriptor.id === step.adapter)
            ?.platforms.includes("win32") === true
      )
    ).toBe(true);
  }
});

test("links are independently enabled and their override provenance is visible", () => {
  const parsed = parseConfigTable(
    {
      markdown: { enabled: false, links: true },
      overrides: [{ markdown: { links: false }, paths: ["vendor/**"] }],
      pilot: 0,
    },
    { file: "rope.toml", prefix: "" }
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    return;
  }
  const plan = resolve(parsed.value);
  expect(plan.paths[0]?.steps.map((step) => step.adapter)).toEqual(["lychee"]);
  expect(plan.paths[1]?.steps).toEqual([]);
  expect(
    plan.paths[1]?.policy.find((setting) => setting.key === "markdown.links")
  ).toEqual({
    key: "markdown.links",
    source: {
      file: "rope.toml",
      key: "overrides.0.markdown.links",
      kind: "file",
    },
    value: false,
  });
});
