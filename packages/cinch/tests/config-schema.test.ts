import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseConfigTable } from "../src/config/parse.ts";
import { configJsonSchema } from "../src/config/schema.ts";

const PUBLISHED = path.resolve(import.meta.dir, "../schemas/cinch.schema.json");
const ORIGIN = { file: "cinch.toml", prefix: "" };

test("the published schema is the one the loader's definition gives", async () => {
  const published: unknown = await Bun.file(PUBLISHED).json();
  // To refresh: bun run cinch schema config > packages/cinch/schemas/cinch.schema.json
  expect(published).toEqual(configJsonSchema());
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
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-tp-")));
  try {
    await Bun.write(path.join(root, "cinch.toml"), text);
    const child = Bun.spawn(
      [
        "taplo",
        "lint",
        "--colors",
        "never",
        "--no-auto-config",
        "--schema",
        Bun.pathToFileURL(PUBLISHED).href,
        "cinch.toml",
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

test("Taplo flags an unknown key against the published schema", async () => {
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
