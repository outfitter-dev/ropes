import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import { factsIn, parseResolved } from "../src/adapters/rumdl/facts.ts";
import { createCommands } from "../src/commands/registry.ts";
import { ResultSchema } from "../src/contracts/result.ts";

const PRINTED = `[global]
disable = ["MD013"]     [from .outfitter/configs/presets/rumdl.toml]
line_length = 120       [from .rumdl.toml]
flavor = "standard"     [from default]

[MD013]
line-length = 80 [from default]
code-blocks = true [from default]
`;

test("the engine's printed config is read with the file behind each value", () => {
  expect(parseResolved(PRINTED).get("global.line-length")).toEqual({
    from: ".rumdl.toml",
    value: "120",
  });
  expect(factsIn(PRINTED, "/repo")).toEqual([
    {
      file: ".rumdl.toml",
      key: "global.line-length",
      name: "line_width",
      value: 120,
    },
  ]);
  const rule = PRINTED.replace(
    "line-length = 80 [from default]",
    "line-length = 90 [from /repo/docs/base.toml]"
  );
  expect(factsIn(rule, "/repo")).toEqual([
    {
      file: "docs/base.toml",
      key: "MD013.line-length",
      name: "line_width",
      value: 90,
    },
  ]);
  expect(factsIn(PRINTED.replace(".rumdl.toml", "default"), "/repo")).toEqual(
    []
  );
});

test("a config path that holds a closing bracket is still read", () => {
  const bracketed = PRINTED.replace(
    ".rumdl.toml",
    "configs/[shared]/base.toml"
  );
  expect(factsIn(bracketed, "/repo")).toEqual([
    {
      file: "configs/[shared]/base.toml",
      key: "global.line-length",
      name: "line_width",
      value: 120,
    },
  ]);
});

const installed = Bun.which("rumdl") !== null;
const CONFIG = "pilot = 0\n\n[editor]\nline_width = 100\n";
const REPO = {
  ".git/HEAD": "",
  "README.md": "# A\n\nText.\n",
  "cinch.toml": CONFIG,
};

const drift = async (authored: string | null): Promise<string[]> => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-facts-"));
  try {
    await Promise.all(
      Object.entries(REPO).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    const commands = createCommands({ adapters: adaptersFor });
    const request = { cwd: root, json: true, paths: [] };
    await commands.doctor?.({ ...request, fix: true });
    if (authored !== null) {
      await Bun.write(path.join(root, ".rumdl.toml"), authored);
    }
    const ran = await commands.check?.(request);
    const result = ResultSchema.parse(JSON.parse(ran?.output ?? ""));
    return result.steps
      .flatMap((step) => step.findings)
      .filter((finding) => finding.rule.startsWith("shared-fact/"))
      .map((finding) => finding.message);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("an authored engine config with another line width is one finding", async () => {
  if (!installed) {
    console.warn("skipped: rumdl is not on PATH, so drift was not measured");
    return;
  }
  const own =
    'extends = ".outfitter/configs/rumdl.toml"\n\n[global]\nline-length = 120\n';
  expect(await drift(own)).toEqual([
    ".rumdl.toml sets `global.line-length` to 120, but cinch.toml sets `editor.line_width` to 100. Both state line_width, so they have to agree. Change one of them.",
  ]);
  expect(await drift(null)).toEqual([]);
});
