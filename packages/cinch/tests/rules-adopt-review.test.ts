import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import type { CommandDeps } from "../src/commands/prepare.ts";
import { adoptRules } from "../src/commands/rules-adopt.ts";

test.each(["bytes", "source"])(
  "adoption refuses a policy %s change saved during planning",
  async (change) => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "rules-stale-"))
    );
    const before = "pilot = 0\n[rules]\nenabled = true\n";
    const newer =
      'pilot = 0\nexclude = ["private/**"]\n[rules]\nenabled = true\n';
    let settlements = 0;
    const deps: CommandDeps = {
      adapters: (...args) =>
        adaptersFor(...args).map((adapter, index) =>
          index === 0
            ? {
                ...adapter,
                settled: async () => {
                  settlements += 1;
                  if (settlements === 2) {
                    await Bun.write(
                      path.join(
                        root,
                        change === "source" ? "cinch.toml" : "rope.toml"
                      ),
                      newer
                    );
                  }
                  return { adapter, ok: true };
                },
              }
            : adapter
        ),
    };
    try {
      await mkdir(path.join(root, ".git"));
      await Bun.write(path.join(root, "rope.toml"), before);
      await Bun.write(path.join(root, "tsconfig.json"), "{}\n");
      const ran = await adoptRules(
        { cwd: root, paths: ["config"], yes: true },
        deps
      );
      expect(settlements).toBe(2);
      expect(ran).toEqual({
        error: "The policy changed during adoption. Run the command again.",
        ok: false,
      });
      expect(await Bun.file(path.join(root, "rope.toml")).text()).toBe(
        change === "source" ? before : newer
      );
      if (change === "source") {
        expect(await Bun.file(path.join(root, "cinch.toml")).text()).toBe(
          newer
        );
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
);
