import assert from "node:assert/strict";
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import core from "../../cinch/package.json" with { type: "json" };
import fixture from "../tests/fixtures/outfitter/package.json" with { type: "json" };
import { run } from "./packed-run.ts";

const SOURCE = fileURLToPath(
  new URL("../tests/fixtures/outfitter/", import.meta.url)
);

export const packConsumer = async (folder: string): Promise<string> => {
  assert.equal(fixture.dependencies["@ropes/core"], core.version);
  assert.deepEqual(Object.keys(fixture.bin), ["outfitter"]);
  const archive = path.join(folder, "outfitter.tgz");
  await run(
    [process.execPath, "pm", "pack", "--ignore-scripts", "--filename", archive],
    SOURCE
  );
  return archive;
};

const decode = (text: string): unknown => JSON.parse(text);

export const proveConsumer = async (consumer: string): Promise<void> => {
  const executable = (name: string) =>
    path.join(consumer, "node_modules/.bin", name);
  assert.equal(await Bun.file(executable("fit")).exists(), false);
  const version = await run([executable("outfitter"), "--version"], consumer);
  assert.equal(
    version.trim(),
    `outfitter ${fixture.version} (@ropes/core ${core.version})`
  );
  await Bun.write(path.join(consumer, ".gitignore"), "node_modules\n");
  await Bun.write(
    path.join(consumer, "cinch.toml"),
    `pilot = 0
exclude = ["excluded/**"]
[markdown]
preset = false
[[overrides]]
paths = ["legacy/**"]
[overrides.markdown]
enabled = false
`
  );
  await Bun.write(path.join(consumer, "clean.md"), "# Clean\n\nText.\n");
  await Bun.write(
    path.join(consumer, "bad.md"),
    "# First\n\nText.\n\n# Second\n\nText.\n"
  );
  await Bun.write(path.join(consumer, "legacy/skip.md"), "# Skipped\n");
  await Bun.write(path.join(consumer, "excluded/skip.md"), "# Excluded\n");
  const emptyPath = path.join(consumer, "no-tools");
  await mkdir(emptyPath);
  const git = Bun.which("git");
  if (git === null) {
    throw new Error(
      "The packed launcher proof needs Git for install verification."
    );
  }
  await symlink(git, path.join(emptyPath, "git"));
  await run(["git", "add", "--all"], consumer);
  const before = await run(
    ["git", "status", "--porcelain", "--untracked-files=all"],
    consumer
  );
  const compare = async (
    args: readonly string[],
    exitCode = 0,
    searchPath?: string
  ): Promise<unknown> => {
    const [rope, outfitter] = await Promise.all(
      ["rope", "outfitter"].map((name) =>
        run([process.execPath, executable(name), ...args, "--json"], consumer, {
          exitCode,
          ...(searchPath === undefined ? {} : { searchPath }),
        })
      )
    );
    assert.equal(typeof rope, "string");
    assert.equal(typeof outfitter, "string");
    const expected = decode(rope ?? "");
    assert.deepEqual(decode(outfitter ?? ""), expected);
    return expected;
  };
  await compare(["check", "clean.md"]);
  await compare(["check", "bad.md"], 1);
  await compare(["check", "bad.md"], 2, emptyPath);
  await compare(["explain", "clean.md"]);
  const overridden = await compare(["explain", "legacy/skip.md"]);
  assert.match(JSON.stringify(overridden), /overrides\.0\.markdown\.enabled/u);
  const excluded = await compare(["explain", "excluded/skip.md"]);
  assert.match(JSON.stringify(excluded), /"reason":"excluded"/u);
  await compare(["fix", "bad.md", "--dry-run"]);
  await run(["git", "diff", "--exit-code"], consumer);
  assert.equal(
    await run(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      consumer
    ),
    before
  );
  await run([executable("outfitter"), "fix", "bad.md", "--json"], consumer);
  assert.equal(
    await Bun.file(path.join(consumer, "bad.md")).text(),
    "# First\n\nText.\n\n## Second\n\nText.\n"
  );
  await compare(["check", "bad.md"]);
  console.log(
    "Private outfitter consumer matched rope plans, results, exits, preview, and applied fix."
  );
};
