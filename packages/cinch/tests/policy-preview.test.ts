import { expect, test } from "bun:test";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import { capturePolicy } from "../src/commands/policy-preview.ts";
import { comparePolicy } from "../src/policy/compare-policy.ts";
import { renderPolicyPreview } from "../src/render/policy-preview.ts";
import { withFixture } from "./acceptance-repo.ts";

test("a skipped artifact version still shows a newly introduced blocking rule", async () => {
  await withFixture(async ({ main }) => {
    const name = "tsconfig.json";
    await Bun.write(path.join(main.root, name), "{}\n");
    await Bun.write(
      path.join(main.root, "cinch.toml"),
      'pilot = 0\ninclude = ["tsconfig.json"]\n[rules]\nenabled = true\npacks = ["config"]\n'
    );
    const capture = {
      at: "2027-02-01T00:00:00Z",
      cwd: main.root,
      paths: [name],
    };
    const before = await capturePolicy(
      capture,
      {
        adapters: (...args) =>
          adaptersFor(...args).map(({ settled: _recreate, ...adapter }) =>
            adapter.descriptor.packs === undefined
              ? adapter
              : {
                  ...adapter,
                  descriptor: {
                    ...adapter.descriptor,
                    packs: adapter.descriptor.packs.map((pack) => ({
                      ...pack,
                      rules: pack.rules.filter(
                        (id) => id !== "config/tsconfig-extends"
                      ),
                    })),
                  },
                }
          ),
      },
      "@ropes/core@0.1.0"
    );
    const after = await capturePolicy(
      capture,
      { adapters: adaptersFor },
      "@ropes/core@0.3.0"
    );
    if (!before.ok || !after.ok) {
      throw new Error(JSON.stringify({ after, before }));
    }
    const old = before.value;
    const next = after.value;
    const preview = comparePolicy(old, next, ["before.json", "after.json"]);
    expect(renderPolicyPreview(preview)).toContain(
      "Rule catalog added config/tsconfig-extends"
    );
    expect(preview.changes).toMatchObject([
      {
        after: { state: "blocking" },
        before: { state: "absent" },
        inputs: ["artifact rule catalog"],
        path: name,
        rule: "config/tsconfig-extends",
      },
    ]);
    expect(
      comparePolicy(next, old, ["after.json", "before.json"]).changes
    ).toMatchObject([
      { after: { state: "absent" }, before: { state: "blocking" } },
    ]);
  });
});
