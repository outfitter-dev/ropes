import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readPacks } from "../src/adapters/ast-grep/rules.ts";

const pack = async (fixable: readonly string[], fix = 'fix: "after"\n') => {
  const dir = await mkdtemp(path.join(tmpdir(), "rope-fixable-pack-"));
  try {
    await Bun.write(
      path.join(dir, "example", "pack.toml"),
      `name = "example"\nabout = "An example."\nrelevant = ["**/*.json"]\nfixable = ${JSON.stringify(fixable)}\n`
    );
    await Bun.write(
      path.join(dir, "example", "sample.yml"),
      `id: example/sample\n${fix}`
    );
    return await readPacks(pathToFileURL(`${dir}/`));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

test("a shipped rewrite is eligible only when its pack opts in by rule name", async () => {
  const optedIn = await pack(["sample"]);
  const reportOnly = await pack([]);
  expect(optedIn.packs[0]?.fixable).toEqual(["sample"]);
  expect(reportOnly.packs[0]?.fixable).toEqual([]);
});

test.each(['fix: ""\n', 'fix: { template: "after" }\n'])(
  "the pack recognizes the pinned engine rewrite form %s",
  async (fix) => {
    const optedIn = await pack(["sample"], fix);
    expect(optedIn.packs[0]?.fixable).toEqual(["sample"]);
  }
);

test("a pack rejects unknown, duplicate and unsupported shipped rewrites", async () => {
  await assert.rejects(pack(["missing"]), /unknown fixable rule/u);
  await assert.rejects(pack(["sample", "sample"]), /more than once/u);
  await assert.rejects(pack(["sample"], ""), /without a supported rewrite/u);
  await assert.rejects(
    pack(["sample"], 'fix: ["first", "second"]\n'),
    /expected a string or a template object/u
  );
});
