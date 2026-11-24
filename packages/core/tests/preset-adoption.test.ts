import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CONFIG_PATH,
  rumdlPresetAdapter,
} from "../src/adapters/rumdl/preset.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { describeFake } from "./fake-adapter.ts";
import { fixOne } from "./one-file.ts";

const inRoot = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-adopt-"));
  try {
    await Promise.all(
      Object.entries(files).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const preset = rumdlPresetAdapter();
const OWN = "[MD007]\nindent = 4\n";

const ELSEWHERE: readonly (readonly [string, string])[] = [
  ["rumdl.toml", OWN],
  [".config/rumdl.toml", OWN],
  ["pyproject.toml", "[tool.rumdl.MD007]\nindent = 4\n"],
];

for (const [name, text] of ELSEWHERE) {
  test(`a repository configured in ${name} is not given a config that hides it`, async () => {
    await inRoot({ [name]: text }, async (root) => {
      const outcome = await fixOne(preset, { path: CONFIG_PATH, root });
      expect(outcome.status).toBe("findings");
      expect(outcome.findings[0]).toMatchObject({ fixable: false });
      expect(outcome.findings[0]?.message).toContain(name);
      expect(await Bun.file(path.join(root, CONFIG_PATH)).exists()).toBe(false);
    });
  });
}

test("a pyproject.toml that says nothing about the engine does not block the config", async () => {
  const files = { "pyproject.toml": '[project]\nname = "x"\n' };
  await inRoot(files, async (root) => {
    const outcome = await fixOne(preset, { path: CONFIG_PATH, root });
    expect(outcome.status).toBe("fixed");
  });
});

test("a config that is already there wins over one elsewhere", async () => {
  const files = { [CONFIG_PATH]: OWN, "rumdl.toml": OWN };
  await inRoot(files, async (root) => {
    const outcome = await fixOne(preset, { path: CONFIG_PATH, root });
    expect(outcome.status).toBe("fixed");
  });
});

test("the files an adapter keeps are planned before the files that read them", () => {
  const markdown = describeFake({ id: "fake-markdown", tool: "fake" });
  const keeper = describeFake({
    extensions: [],
    id: "fake-keeper",
    owns: [".tool.toml", ".ropes/configs/tool.toml"],
  });
  const plan = resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: [markdown, keeper],
    packages: [],
    paths: ["z.md", ".tool.toml", ".github/a.md", ".ropes/configs/tool.toml"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  expect(plan.paths.map((entry) => entry.path)).toEqual([
    ".ropes/configs/tool.toml",
    ".tool.toml",
    ".github/a.md",
    "z.md",
  ]);
});
