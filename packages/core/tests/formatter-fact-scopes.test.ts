import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readFacts } from "../src/adapters/bun-fmt/facts.ts";

const inRepo = async (body: (root: string) => Promise<void>) => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "fmt-scopes-"))
  );
  try {
    await Bun.write(path.join(root, "safe/a.ts"), "const a = 1;\n");
    await Bun.write(path.join(root, "safe/b.ts"), "const b = 2;\n");
    await Bun.write(path.join(root, "unsafe/a.ts"), "const c = 3;\n");
    await Bun.write(
      path.join(root, "safe/.prettierrc.json"),
      '{"printWidth":100}\n'
    );
    await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const executable = (sentinel: string) =>
  `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(sentinel)}, "executed"); export default {printWidth: 120};\n`;

test("dynamic sibling limits only its own scope and never executes", async () => {
  await inRepo(async (root) => {
    const sentinel = path.join(root, "sentinel");
    await Bun.write(
      path.join(root, "unsafe/prettier.config.js"),
      executable(sentinel)
    );
    const report = await readFacts(process.execPath, root, [
      "unsafe/a.ts",
      "safe/a.ts",
      "safe/b.ts",
    ]);
    expect(report).toMatchObject({
      facts: [
        { file: "safe/.prettierrc.json", path: "safe/a.ts", value: 100 },
        { file: "safe/.prettierrc.json", path: "safe/b.ts", value: 100 },
      ],
      ok: true,
    });
    if (report.ok) {
      expect(report.limitations?.join("\n")).toContain(
        path.join("unsafe", "prettier.config.js")
      );
    }
    expect(await Bun.file(sentinel).exists()).toBe(false);
  });
});

test("dynamic root still blocks all selected scopes without executing", async () => {
  await inRepo(async (root) => {
    const sentinel = path.join(root, "sentinel");
    await Bun.write(
      path.join(root, "prettier.config.js"),
      executable(sentinel)
    );
    const report = await readFacts(process.execPath, root, [
      "unsafe/a.ts",
      "safe/a.ts",
    ]);
    expect(report).toMatchObject({ facts: [], ok: true });
    if (report.ok) {
      expect(report.limitations).toHaveLength(1);
      expect(report.limitations?.join("\n")).toContain(
        "native discovery may execute"
      );
    }
    expect(await Bun.file(sentinel).exists()).toBe(false);
  });
});
