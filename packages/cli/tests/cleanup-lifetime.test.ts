import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { runCleanup } from "../../cinch/src/commands/cleanup.ts";
import { withFixture } from "../../cinch/tests/acceptance-repo.ts";
import { fakeAdapter, PASSED } from "../../cinch/tests/fake-adapter.ts";
import { accepted, commit, fixed, RULE } from "./cleanup-fixture.ts";

test("cleanup releases earlier snapshot directories before checking the next one", async () => {
  await withFixture(async ({ main }) => {
    const policy = await accepted(main.root);
    await fixed(main.root, "a");
    await commit(main.root);
    await fixed(main.root, "b");
    const parent = await commit(main.root);
    await fixed(main.root, "c");
    const candidate = await commit(main.root);
    const digest = policy.policy.ruleSha256;
    if (digest === undefined) {
      throw new Error("missing fixture digest");
    }
    const adapter = fakeAdapter({
      check: async ({ root }) => {
        expect(await readdir(path.dirname(root))).toEqual([
          path.basename(root),
        ]);
        return PASSED;
      },
      descriptor: {
        enabledBy: "rules.enabled",
        extensions: [".json"],
        packs: [
          {
            about: "A tested rule",
            name: "config",
            relevant: ["**/tsconfig.json"],
            rules: [RULE],
          },
        ],
        ruleDigests: { [RULE]: digest },
        ruleIdentities: { [RULE]: "single-json-document" },
        versionRange: "1.0.0",
      },
      probe: () => Promise.resolve({ available: true, version: "1.0.0" }),
    });
    const compared = await runCleanup(
      {
        candidate,
        cwd: main.root,
        parent,
        policy: `${policy.approved}:migration.json`,
      },
      { adapters: () => [adapter] },
      true
    );
    expect(compared).toMatchObject({ ok: true, value: { outcome: "clean" } });
    expect(adapter.batches.length).toBeGreaterThan(3);
  });
});
