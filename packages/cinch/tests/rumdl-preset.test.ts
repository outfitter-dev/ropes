import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { rumdlAdapter } from "../src/adapters/rumdl/adapter.ts";

const PRESET = path.join(import.meta.dir, "..", "presets", "rumdl.toml");
const CONFIG = `extends = ${JSON.stringify(PRESET)}\n`;

const fence = (code: string): string => `# A\n\n\`\`\`ts\n${code}\n\`\`\`\n`;

const ready = Bun.which("rumdl") !== null && Bun.which("bun") !== null;
/** A real-engine test. It says so when an engine is not there to run it. */
const withEngines = (name: string, body: () => Promise<void>) => {
  test(name, async () => {
    if (!ready) {
      console.warn(
        `skipped: rumdl or bun is not on PATH, so "${name}" did not run`
      );
      return;
    }
    await body();
  });
};

const inRepo = async <T>(
  text: string,
  body: (root: string, read: () => Promise<string>) => Promise<T>
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-preset-"));
  try {
    await Bun.write(path.join(root, ".rumdl.toml"), CONFIG);
    await Bun.write(path.join(root, "a.md"), text);
    return await body(root, () => Bun.file(path.join(root, "a.md")).text());
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const input = (root: string) => ({ path: "a.md", root });

withEngines("the preset applies its list marker rule", async () => {
  const outcome = await inRepo("# A\n\n* one\n* two\n", (root) =>
    rumdlAdapter().check(input(root))
  );
  expect(outcome.findings.map((finding) => finding.rule)).toEqual([
    "MD004",
    "MD004",
  ]);
});

withEngines("the preset turns on the rules rumdl leaves off", async () => {
  const text = [
    "# T\n\nText.\n\n## Same\n\n## Same\n\nBody.\n\n",
    "## A **bold** `code` one\n\nBody\n  indented.\n\n",
    "<!-- rumdl-disable-next-line MD001 -->\nFine.\n\n",
    "## Parent\n\n### Child\n\nBody.\n",
  ].join("");
  const outcome = await inRepo(text, (root) =>
    rumdlAdapter().check(input(root))
  );
  expect(outcome.findings.map((finding) => finding.rule)).toEqual([
    "MD082",
    "MD024",
    "MD080",
    "MD093",
    "MD085",
    "MD087",
  ]);
});

withEngines("the preset allows what it switches off", async () => {
  const text = "Intro, with no first heading.\n\n## Done!\n\n<b>hi</b>\n";
  const outcome = await inRepo(text, (root) =>
    rumdlAdapter().check(input(root))
  );
  expect(outcome).toEqual({ findings: [], status: "passed" });
});

withEngines(
  "check reports an unformatted fence and writes nothing",
  async () => {
    const text = fence("const   x = {a:1}");
    const [outcome, after] = await inRepo(text, async (root, read) => [
      await rumdlAdapter().check(input(root)),
      await read(),
    ]);
    expect(after).toBe(text);
    expect(outcome.status).toBe("findings");
    expect(outcome.findings).toEqual([
      {
        // rumdl marks this as not fixable, although `fix` does rewrite the block.
        fixable: false,
        message: "Code block is not formatted",
        path: "a.md",
        range: { start: { column: 1, line: 3 } },
        rule: "bun-fmt:ts",
        severity: "warning",
        source: "rumdl",
      },
    ]);
  }
);

withEngines(
  "fix formats a fence, and a second fix changes nothing",
  async () => {
    const [first, after, second] = await inRepo(
      fence("const   x = {a:1}"),
      async (root, read) => [
        await rumdlAdapter().fix(input(root)),
        await read(),
        await rumdlAdapter().fix(input(root)),
      ]
    );
    expect(first).toEqual({ findings: [], status: "fixed" });
    expect(after).toBe(fence("const x = { a: 1 };"));
    expect(second).toEqual({ findings: [], status: "passed" });
  }
);

withEngines(
  "a fence that does not parse leaves the step incomplete",
  async () => {
    const text = fence("const x = {");
    const [checked, fixed, after] = await inRepo(text, async (root, read) => [
      await rumdlAdapter().check(input(root)),
      await rumdlAdapter().fix(input(root)),
      await read(),
    ]);
    expect(checked.status).toBe("incomplete");
    expect(checked.reason).toStartWith(
      "rumdl ran, but it could not check the fenced block at line 3: Tool 'bun' failed"
    );
    expect(fixed.status).toBe("incomplete");
    expect(after).toBe(text);
  }
);
