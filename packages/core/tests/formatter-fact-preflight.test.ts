import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoveryLimit } from "../src/adapters/bun-fmt/fact-config.ts";
import { readFacts } from "../src/adapters/bun-fmt/facts.ts";

test.skipIf(process.platform === "win32")(
  "static TOML plugins stop native config discovery before execution",
  async () => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "fmt-preflight-"))
    );
    try {
      await Bun.write(
        path.join(root, ".prettierrc.toml"),
        'plugins = ["./plugin.js"]\n'
      );
      const command = path.join(root, "formatter");
      await Bun.write(
        command,
        '#!/bin/sh\nprintf started > "$0.started"\nexit 70\n'
      );
      await chmod(command, 0o755);
      const report = await readFacts(command, root, ["a.ts"]);
      expect(report).toMatchObject({ facts: [], ok: true });
      if (report.ok) {
        expect(report.limitations?.join("\n")).toContain(
          "may load executable configuration or plugins"
        );
      }
      expect(await Bun.file(`${command}.started`).exists()).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
);

test("missing candidate directories still inspect existing ancestors", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "fmt-missing-"))
  );
  try {
    await Bun.write(
      path.join(root, "prettier.config.js"),
      "export default {};"
    );
    expect(await discoveryLimit(root, ["missing/deep/a.ts"], [])).toContain(
      "native discovery may execute"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "an unreadable existing candidate directory remains an observation failure",
  async () => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "fmt-unreadable-"))
    );
    const blocked = path.join(root, "blocked");
    await mkdir(blocked);
    try {
      await chmod(blocked, 0o000);
      const report = await readFacts("bun", root, ["blocked/a.ts"]);
      expect(report.ok).toBe(false);
      if (!report.ok) {
        expect(report.reason).toContain("EACCES");
      }
    } finally {
      await chmod(blocked, 0o755);
      await rm(root, { force: true, recursive: true });
    }
  }
);
