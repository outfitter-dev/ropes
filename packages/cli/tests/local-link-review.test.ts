import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import path from "node:path";

import { parseResult } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../core/tests/acceptance-repo.ts";
import { CONFIG } from "./local-links-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("literal source paths containing glob syntax cannot be skipped", async () => {
  if (Bun.which("lychee") === null) {
    console.warn(
      "skipped: lychee is not on PATH, so literal sources were not checked"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(path.join(main.root, "target.md"), "# Target\n");
    // Keep each named selection isolated so a skipped file cannot borrow another result.
    /* eslint-disable no-await-in-loop */
    for (const folder of [
      "[slug]",
      "star*",
      "question?",
      "{brace}",
      "close]",
      "open[",
    ]) {
      const source = `docs/${folder}/guide.md`;
      await Bun.write(
        path.join(main.root, source),
        "# Guide\n\n[Missing](../../target.md#missing)\n"
      );
      const ran = await runEntry(ROPE, ["check", source, "--json"], main.root);
      expect(ran.exitCode).toBe(1);
      const result = parseResult(json(ran));
      expect(result.ok).toBe(true);
      if (result.ok) {
        const local = result.value.steps.find(
          (step) => step.adapter === "lychee"
        );
        expect(local?.path).toBe(source);
        expect(local?.status).toBe("findings");
        expect(local?.findings.map((finding) => finding.rule)).toEqual([
          "local-fragment",
        ]);
      }
    }
    /* eslint-enable no-await-in-loop */
  });
});

test("an unreadable fragment target is incomplete even with inherited logging disabled", async () => {
  if (Bun.which("lychee") === null) {
    console.warn(
      "skipped: lychee is not on PATH, so skipped fragment warnings were not checked"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(
      path.join(main.root, "index.md"),
      "# Index\n\n[Unreadable](bad.md#heading)\n"
    );
    await Bun.write(path.join(main.root, "bad.md"), new Uint8Array([255, 254]));
    const child = Bun.spawn(
      [process.execPath, ROPE.pathname, "check", "index.md", "--json"],
      {
        cwd: main.root,
        env: { ...process.env, RUST_LOG: "off" },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [code, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(2);
    const result = parseResult(JSON.parse(stdout));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const local = result.value.steps.find(
        (step) => step.adapter === "lychee"
      );
      expect(local?.status).toBe("incomplete");
      expect(local?.reason).toContain("Skipping fragment check");
    }
  });
});

test("existing Markdown consumers do not need or plan the opt-in link engine", async () => {
  const rumdl = Bun.which("rumdl");
  if (rumdl === null) {
    console.warn(
      "skipped: rumdl is not on PATH, so legacy Markdown was not checked"
    );
    return;
  }
  await withFixture(async ({ main, emptyPath }) => {
    await symlink(rumdl, path.join(emptyPath, "rumdl"));
    await Bun.write(
      path.join(main.root, "rope.toml"),
      CONFIG.replace("links = true\n", "")
    );
    await Bun.write(path.join(main.root, "index.md"), "# Index\n\nText.\n");
    const ran = await runEntry(
      ROPE,
      ["check", "index.md", "--json"],
      main.root,
      emptyPath
    );
    expect(ran.exitCode).toBe(0);
    expect(parseResult(json(ran))).toMatchObject({
      ok: true,
      value: { steps: [{ adapter: "rumdl", status: "passed" }] },
    });
  });
});
