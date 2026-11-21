import { expect, test } from "bun:test";
import path from "node:path";

import { parsePlan, parseResult } from "@ropes/core";

import { FixReportSchema } from "../../cinch/src/contracts/fix.ts";
import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import { CONFIG } from "./local-links-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("selected Markdown validates cross-package local files and headings offline", async () => {
  if (Bun.which("lychee") === null) {
    console.warn(
      "skipped: lychee is not on PATH, so the local link proof did not run"
    );
    return;
  }
  await withFixture(async ({ main, emptyPath }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await Bun.write(
      path.join(main.root, "packages/guide/package.json"),
      '{"name":"guide"}\n'
    );
    await Bun.write(
      path.join(main.root, "packages/guide/guide.md"),
      "# Guide\n\n## Install `code`\n\nText.\n"
    );
    await Bun.write(
      path.join(main.root, "index.md"),
      "# Index\n\n[Good](packages/guide/guide.md#install-code)\n\n[Missing file](missing.md)\n\n[Missing heading](packages/guide/guide.md#missing)\n\n[Missing self](#missing)\n"
    );
    // Native settings must not remove the checks shown by the Ropes plan.
    await Bun.write(
      path.join(main.root, "lychee.toml"),
      'exclude = [".*"]\npreprocess = { command = "touch preprocessed" }\n'
    );
    await Bun.write(path.join(main.root, ".lycheeignore"), ".*\n");
    const before = await main.files();
    const checked = await runEntry(
      ROPE,
      ["check", "index.md", "--json"],
      main.root
    );
    expect(checked.exitCode).toBe(1);
    const result = parseResult(json(checked));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const local = result.value.steps.find((step) => step.adapter === "lychee");
    expect(local?.findings.map(({ rule }) => rule)).toEqual([
      "local-file",
      "local-fragment",
      "local-fragment",
    ]);
    expect(local?.findings.map(({ range }) => range.start.line)).toEqual([
      5, 7, 9,
    ]);
    expect(
      result.value.plan.paths.every((entry) => entry.path === "index.md")
    ).toBe(true);
    const explained = parsePlan(
      json(await runEntry(ROPE, ["explain", "index.md", "--json"], main.root))
    );
    expect(explained).toEqual({ ok: true, value: result.value.plan });
    const traced = await runEntry(
      ROPE,
      ["explain", "index.md", "--trace"],
      main.root
    );
    expect(traced.stdout).toContain("--offline=true");
    expect(traced.stdout).toContain("--include-fragments=anchor-only");
    expect(await main.files()).toEqual(before);
    expect(await Bun.file(path.join(main.root, "preprocessed")).exists()).toBe(
      false
    );
    const noEngine = await runEntry(
      ROPE,
      ["check", "index.md", "--json"],
      main.root,
      emptyPath
    );
    expect(noEngine.exitCode).toBe(2);
    await Bun.write(
      path.join(main.root, "cinch.toml"),
      `${CONFIG}\n[[overrides]]\npaths = ["index.md"]\n[overrides.markdown]\nenabled = false\n`
    );
    const disabled = await runEntry(
      ROPE,
      ["check", "index.md", "--json"],
      main.root,
      emptyPath
    );
    expect(disabled.exitCode).toBe(0);
  });
});

test("local link checking never requests an external URL", async () => {
  if (Bun.which("lychee") === null) {
    console.warn(
      "skipped: lychee is not on PATH, so the offline network proof did not run"
    );
    return;
  }
  let requests = 0;
  const server = Bun.serve({
    fetch: () => {
      requests += 1;
      return new Response("unexpected");
    },
    port: 0,
  });
  try {
    await withFixture(async ({ main }) => {
      await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
      await Bun.write(
        path.join(main.root, "external.md"),
        `# External\n\n[External](${server.url.href})\n`
      );
      const ran = await runEntry(
        ROPE,
        ["check", "external.md", "--json"],
        main.root
      );
      expect(ran.exitCode).toBe(0);
      expect(requests).toBe(0);
    });
  } finally {
    await server.stop(true);
  }
});

test("link previews retain ignored target headings without changing the checkout", async () => {
  if (Bun.which("lychee") === null) {
    console.warn(
      "skipped: lychee is not on PATH, so the link preview proof did not run"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await Bun.write(path.join(main.root, ".gitignore"), "generated/\n");
    await Bun.write(
      path.join(main.root, "generated/guide.md"),
      "# Guide\n\n## Generated\n\nText.\n"
    );
    await Bun.write(
      path.join(main.root, "index.md"),
      "# Index\n\n[Generated](generated/guide.md#generated)\n\n[Directory](generated/)\n"
    );
    const before = await main.files();
    const actual = await runEntry(
      ROPE,
      ["fix", "index.md", "--json"],
      main.root
    );
    const preview = await runEntry(
      ROPE,
      ["fix", "index.md", "--dry-run", "--json"],
      main.root
    );
    expect(actual.exitCode).toBe(0);
    expect(preview.exitCode).toBe(0);
    const report = FixReportSchema.parse(json(preview));
    expect({ ...report, dryRun: false }).toEqual(
      FixReportSchema.parse(json(actual))
    );
    expect(await main.files()).toEqual(before);
  });
});
