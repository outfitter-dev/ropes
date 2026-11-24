import { expect, test } from "bun:test";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import { runEntry, withFixture } from "../../cinch/tests/acceptance-repo.ts";
import { CONFIG } from "./local-links-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("a preview never extracts links with an incompatible engine", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(path.join(main.root, "index.md"), "# Index\n\nText.\n");
    const tools = path.join(main.root, "tools");
    const marker = path.join(main.root, "extracted");
    await mkdir(tools);
    const engine = path.join(tools, "lychee");
    await Bun.write(
      engine,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'lychee 9.9.9\\n'; exit 0; fi\nprintf called > '${marker}'\nexit 1\n`
    );
    await chmod(engine, 0o755);
    const ran = await runEntry(
      ROPE,
      ["fix", "index.md", "--dry-run", "--json"],
      main.root,
      tools
    );
    expect(ran.exitCode).toBe(2);
    expect(await Bun.file(marker).exists()).toBe(false);
  });
});

test("preview snapshots use the plan's accepted newer version and strictness", async () => {
  if (Bun.which("lychee") === null) {
    console.warn(
      "skipped: lychee is not on PATH, so version parity was not checked"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(
      path.join(main.root, "mise.toml"),
      '[tools]\nlychee = "0.24.1"\n'
    );
    await Bun.write(path.join(main.root, ".gitignore"), "generated/\n");
    await Bun.write(path.join(main.root, "generated/guide.md"), "# Guide\n");
    await Bun.write(
      path.join(main.root, "index.md"),
      "# Index\n\n[Guide](generated/guide.md#guide)\n"
    );
    for (const args of [
      ["fix", "index.md", "--json"],
      ["fix", "index.md", "--dry-run", "--json"],
      ["fix", "index.md", "--dry-run", "--strict", "--json"],
    ]) {
      const child = Bun.spawn([process.execPath, ROPE.pathname, ...args], {
        cwd: main.root,
        env: { ...process.env, CI: "false" },
        stderr: "pipe",
        stdout: "pipe",
      });
      // The real write precedes its preview; strictness is checked last.
      // eslint-disable-next-line no-await-in-loop -- preserve that command order
      const [code, stdout] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(args.includes("--strict") ? 2 : 0);
      expect(stdout).not.toContain("File not found");
    }
    await Bun.write(
      path.join(main.root, "mise.toml"),
      '[tools]\nlychee = "0.24.3"\n'
    );
    const old = await runEntry(
      ROPE,
      ["fix", "index.md", "--dry-run", "--json"],
      main.root
    );
    expect(old.exitCode).toBe(2);
    expect(old.stdout).toContain("does not satisfy 0.24.3");
    expect(old.stdout).not.toContain("File not found");
  });
});

test("an absent preview engine remains incomplete without attempting extraction", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(path.join(main.root, "index.md"), "# Index\n\nText.\n");
    const ran = await runEntry(
      ROPE,
      ["fix", "index.md", "--dry-run", "--json"],
      main.root,
      emptyPath
    );
    expect(ran.exitCode).toBe(2);
    expect(ran.stdout).toContain("lychee is not on PATH");
    expect(ran.stderr).not.toContain("inputs for");
  });
});
