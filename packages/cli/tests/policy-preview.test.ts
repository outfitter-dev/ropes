import { expect, test } from "bun:test";
import path from "node:path";

import {
  json,
  runEntry,
  withFixture,
} from "../../core/tests/acceptance-repo.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const RULE = "config/tsconfig-extends";
const REWRITE = "config-spelling/tsconfig-module-esnext";
const API = "typescript-api/removed-map";
const FILE = "packages/app/tsconfig.json";
const SOURCE = "packages/app/index.ts";
const EXCLUDED = "packages/legacy/tsconfig.json";
const BEFORE = "2027-01-31T23:59:59.999Z";
const AFTER = "2027-02-01T00:00:00.000Z";
const POLICY = `pilot = 0
include = ["**/tsconfig.json", "**/*.ts"]
exclude = ["packages/legacy/**"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[rules]
enabled = true
packs = ["config", "typescript-api"]
[rules.enforcement]
"${RULE}" = "2027-02-01"
`;

test("policy preview compares the clock and package target without running engines or writing", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    const config = path.join(main.root, "rope.toml");
    const manifest = path.join(main.root, "packages/app/package.json");
    await Promise.all([
      Bun.write(config, POLICY),
      Bun.write(manifest, '{"peerDependencies":{"typescript":"^4.9.0"}}\n'),
      Bun.write(path.join(main.root, FILE), "{}\n"),
      Bun.write(path.join(main.root, SOURCE), "export {};\n"),
      Bun.write(path.join(main.root, EXCLUDED), "{}\n"),
    ]);
    const run = (args: readonly string[]) =>
      runEntry(ROPE, args, main.root, emptyPath);
    const snapshot = (at: string, paths: readonly string[]) =>
      run(["policy", "snapshot", ...paths, "--at", at, "--json"]);
    const selection = [FILE, SOURCE, EXCLUDED];
    const old = await snapshot(BEFORE, selection);
    await Bun.write(manifest, '{"peerDependencies":{"typescript":"^5.0.0"}}\n');
    const next = await snapshot(AFTER, selection);
    expect(old.exitCode).toBe(0);
    expect(next.exitCode).toBe(0);
    expect(json(next)).toMatchObject({
      evidence: "planned",
      paths: [
        { path: SOURCE, rules: [{ rule: API, state: "blocking" }] },
        {
          path: FILE,
          rules: [
            { rule: REWRITE, state: "inapplicable" },
            { rule: RULE, state: "blocking" },
          ],
        },
        {
          path: EXCLUDED,
          rules: [
            { rule: REWRITE, state: "exempt" },
            { rule: RULE, state: "exempt" },
          ],
        },
      ],
    });
    const names = ["../before.json", "../after.json"];
    await Promise.all(
      names.map((name, index) =>
        Bun.write(
          path.join(main.root, name),
          index === 0 ? old.stdout : next.stdout
        )
      )
    );
    const tree = await main.files();
    const index = Bun.file(path.join(main.root, ".git/index"));
    const indexBefore = await index.bytes();
    const preview = await run(["policy", "compare", ...names, "--json"]);
    expect(preview.exitCode).toBe(0);
    expect(json(preview)).toMatchObject({
      changes: [
        {
          after: { state: "blocking" },
          before: { state: "inapplicable" },
          inputs: ["declared package target"],
          package: "packages/app",
          path: SOURCE,
          rule: API,
        },
        {
          after: { state: "blocking" },
          before: { state: "advisory" },
          inputs: ["evaluation time"],
          package: "packages/app",
          path: FILE,
          rule: RULE,
        },
      ],
      evidence: "planned",
      incomplete: [],
    });
    const human = await run(["policy", "compare", ...names]);
    expect(human.stdout).toContain(
      "Policy preview (planning only). No engines ran."
    );
    expect(human.stdout).toContain(`Scope ${selection.join(", ")}`);
    expect(human.stdout).toContain("Changed declared package target");
    expect(human.stdout).toContain("Changed evaluation time");
    expect(await main.files()).toEqual(tree);
    expect(await index.bytes()).toEqual(indexBefore);

    await Bun.write(
      manifest,
      '{"peerDependencies":{"typescript":">=4.9 <6"}}\n'
    );
    const ambiguous = await snapshot(AFTER, selection);
    await Bun.write(path.join(main.root, "../after.json"), ambiguous.stdout);
    const incomplete = await run(["policy", "compare", ...names, "--json"]);
    expect(incomplete.exitCode).toBe(2);
    expect(incomplete.stdout).toContain("spans 5.0.0");
    const narrower = await snapshot(AFTER, [FILE]);
    await Bun.write(path.join(main.root, "../after.json"), narrower.stdout);
    const differentScope = await run(["policy", "compare", ...names]);
    expect(differentScope.exitCode).toBe(2);
    expect(differentScope.stderr).toContain("must select the same");
    await Bun.write(config, POLICY.replace(RULE, "config/renamed-rule"));
    const stale = await snapshot(AFTER, [FILE]);
    expect(stale.exitCode).toBe(2);
    expect(stale.stderr).toContain("unknown shipped rule");
  });
});

test("policy preview distinguishes pack adoption, unrelated edits and missing coverage", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    const config = path.join(main.root, "rope.toml");
    const manifest = path.join(main.root, "packages/app/package.json");
    const markdown = path.join(main.root, "new-notes.md");
    await Promise.all([
      Bun.write(
        config,
        POLICY.replace(
          'packs = ["config", "typescript-api"]',
          'packs = ["config"]'
        )
      ),
      Bun.write(
        manifest,
        '{"version":"1.0.0","peerDependencies":{"typescript":"^5.0.0"}}\n'
      ),
      Bun.write(path.join(main.root, SOURCE), "export {};\n"),
      Bun.write(markdown, "# Notes\n"),
    ]);
    const invoke = (args: readonly string[]) =>
      runEntry(ROPE, args, main.root, emptyPath);
    const capture = async (name: string) => {
      const snapshot = await invoke(["policy", "snapshot", "--at", BEFORE]);
      expect(snapshot.exitCode).toBe(0);
      await Bun.write(path.join(main.root, name), snapshot.stdout);
      return snapshot.stdout;
    };
    const compare = (before: string, after: string) =>
      invoke(["policy", "compare", before, after, "--json"]);
    await capture("../bare.json");
    await Bun.write(config, POLICY);
    const old = await capture("../adopted.json");
    const adopted = await compare("../bare.json", "../adopted.json");
    expect(adopted.exitCode).toBe(0);
    expect(json(adopted)).toMatchObject({
      after: { catalog: [REWRITE, RULE, API] },
      changes: [
        {
          after: { state: "blocking" },
          before: { state: "inapplicable" },
          inputs: ["pack adoption"],
          rule: API,
        },
      ],
    });

    await Bun.write(
      manifest,
      '{"version":"1.0.1","peerDependencies":{"typescript":"^5.0.0"}}\n'
    );
    const revised = await capture("../version-bump.json");
    expect(revised).not.toBe(old);
    expect(
      json(await compare("../adopted.json", "../version-bump.json"))
    ).toMatchObject({ changes: [], incomplete: [] });

    await Bun.file(markdown).delete();
    await capture("../missing.json");
    const missing = await compare("../version-bump.json", "../missing.json");
    expect(missing.exitCode).toBe(2);
    expect(missing.stdout).toContain(
      "new-notes.md: the path is absent from the after snapshot"
    );
  });
});
