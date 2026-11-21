import { expect, test } from "bun:test";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import { runEntry, withFixture } from "../../cinch/tests/acceptance-repo.ts";
import { CONFIG } from "./local-links-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("a preview never extracts links with an incompatible engine", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
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
