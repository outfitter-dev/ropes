import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import path from "node:path";

import { parseResult } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import { CONFIG } from "./local-links-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("nested sources, spaces, Unicode anchors and same-root target aliases resolve", async () => {
  if (Bun.which("lychee") === null) {
    console.warn(
      "skipped: lychee is not on PATH, so the path proof did not run"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await Bun.write(
      path.join(main.root, "docs/nested/guide name.md"),
      "# Café\n\nText.\n"
    );
    await symlink(
      "nested/guide name.md",
      path.join(main.root, "docs/alias.md")
    );
    const name = "docs/space and café.md";
    const source = path.join(main.root, name);
    const clean =
      "# Source\n\n[Guide](<nested/guide name.md#café>)\n\n[Alias](alias.md#café)\n\n[Encoded](nested/guide%20name.md#caf%C3%A9)\n";
    await Bun.write(
      source,
      `${clean}\n[Missing](<nested/guide name.md#missing>)\n`
    );
    const broken = await runEntry(ROPE, ["check", name, "--json"], main.root);
    expect(broken.exitCode).toBe(1);
    const result = parseResult(json(broken));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value.steps.find((step) => step.adapter === "lychee")?.findings
      ).toHaveLength(1);
    }
    await Bun.write(source, clean);
    const passing = await runEntry(ROPE, ["check", name, "--json"], main.root);
    expect(passing.exitCode).toBe(0);
    const preview = await runEntry(
      ROPE,
      ["fix", name, "--dry-run", "--json"],
      main.root
    );
    expect(preview.exitCode).toBe(2);
    expect(preview.stderr).toContain("previews require direct target paths");
  });
});

test("local target reads stop at the policy root, including an escaping symlink", async () => {
  if (Bun.which("lychee") === null) {
    console.warn(
      "skipped: lychee is not on PATH, so the root-boundary proof did not run"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    const outside = path.join(main.root, "..", "outside.md");
    await Bun.write(outside, "# Outside\n\nText.\n");
    await symlink(outside, path.join(main.root, "alias.md"));
    const source = path.join(main.root, "index.md");
    await Bun.write(source, "# Index\n\n[Outside](alias.md#outside)\n");
    const escaped = await runEntry(
      ROPE,
      ["check", "index.md", "--json"],
      main.root
    );
    expect(escaped.exitCode).toBe(2);
    expect(escaped.stdout).toContain("target leaves the policy root");
    await Bun.write(source, "# Index\n\n[Outside](../outside.md#outside)\n");
    const parent = await runEntry(
      ROPE,
      ["check", "index.md", "--json"],
      main.root
    );
    expect(parent.exitCode).toBe(2);
    expect(parent.stdout).toContain("target leaves the policy root");
  });
});
