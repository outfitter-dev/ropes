import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ropesSchema } from "../src/commands/schema.ts";
import { parseConfigTable } from "../src/config/parse.ts";
import { configJsonSchema } from "../src/config/schema.ts";

const PUBLISHED = path.resolve(import.meta.dir, "../schemas/rope.schema.json");
const ORIGIN = { file: "rope.toml", prefix: "" };

test("the published schema is the one the loader's definition gives", async () => {
  const published: unknown = await Bun.file(PUBLISHED).json();
  expect(published).toEqual(configJsonSchema());
  expect(published).toEqual(ropesSchema("config"));
  expect(published).toMatchObject({ title: "rope.toml" });
});

test("the schema refuses a key the loader refuses", () => {
  expect(configJsonSchema()).toMatchObject({
    $schema: "http://json-schema.org/draft-07/schema#",
    additionalProperties: false,
    properties: { pilot: { const: 0 } },
    required: ["pilot"],
  });
  expect(parseConfigTable({ nope: 1, pilot: 0 }, ORIGIN).ok).toBe(false);
});

const lint = async (text: string): Promise<{ code: number; said: string }> => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ropes-tp-")));
  try {
    await Bun.write(path.join(root, "rope.toml"), text);
    await Bun.write(
      path.join(root, ".taplo.toml"),
      await Bun.file(new URL("../../../.taplo.toml", import.meta.url)).text()
    );
    await Bun.write(
      path.join(root, "packages/core/schemas/rope.schema.json"),
      await Bun.file(PUBLISHED).text()
    );
    const child = Bun.spawn(
      [
        "taplo",
        "lint",
        "--colors",
        "never",
        "--config",
        ".taplo.toml",
        "rope.toml",
      ],
      { cwd: root, stderr: "pipe", stdin: "ignore", stdout: "ignore" }
    );
    const [said, code] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, said };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("Taplo resolves the repository schema binding and flags an unknown key", async () => {
  if (Bun.which("taplo") === null) {
    console.warn("skipped: taplo is not on PATH, so the schema was not tried");
    return;
  }
  const good = await lint("pilot = 0\n\n[markdown]\nenabled = true\n");
  expect(good.code).toBe(0);
  const bad = await lint("pilot = 0\nnope = 1\n");
  expect(bad.code).toBe(1);
  expect(bad.said).toContain("'nope' was unexpected");
});

const ruleFolder = (folder: string): string =>
  `pilot = 0\n[rules]\nlocal = [${JSON.stringify(folder)}]\n`;

test("Taplo and the loader enforce the same local rule folder boundary", async () => {
  if (Bun.which("taplo") === null) {
    console.warn("skipped: taplo is not on PATH, so the schema was not tried");
    return;
  }
  const good = "tooling/..rules";
  const bad = "tooling/../shared-rules";
  const [inside, outside] = await Promise.all([
    lint(ruleFolder(good)),
    lint(ruleFolder(bad)),
  ]);
  expect(
    parseConfigTable({ pilot: 0, rules: { local: [good] } }, ORIGIN).ok
  ).toBe(true);
  expect(
    parseConfigTable({ pilot: 0, rules: { local: [bad] } }, ORIGIN).ok
  ).toBe(false);
  expect(inside.code).toBe(0);
  expect(outside.code).toBe(1);
  expect(outside.said).toContain("does not match");
});

test("delegated config paths reject control characters and parent traversal in both validators", async () => {
  if (Bun.which("taplo") === null) {
    console.warn("skipped: taplo is not on PATH, so the schema was not tried");
    return;
  }
  for (const file of [
    "configs/tool.json",
    "nested\n/../.editorconfig",
    "nested\r/file.json",
    "nested\t/file.json",
  ]) {
    const text = `pilot = 0\n[delegates.other]\npaths = ["src/**"]\nconfig = [${JSON.stringify(file)}]\n`;
    const valid = file === "configs/tool.json";
    expect(parseConfigTable(Bun.TOML.parse(text), ORIGIN).ok).toBe(valid);
    // eslint-disable-next-line no-await-in-loop -- exercise each exact authored path against the native validator
    const checked = await lint(text);
    expect(checked.code).toBe(valid ? 0 : 1);
  }
});
