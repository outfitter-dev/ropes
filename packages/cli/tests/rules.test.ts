import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  RulesAdoptReportSchema,
  RulesReportSchema,
} from "../../cinch/src/contracts/rules-report.ts";
import {
  checkoutAt,
  fixtureGit,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";

const cli = new URL("../src/cli.ts", import.meta.url);
const policy = `pilot = 0
include = ["**/tsconfig.json"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[rules]
enabled = true
`;

test("rope previews and adopts packs in the active policy without changing the index", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-rules-"))
  );
  const run = (...args: readonly string[]) => runEntry(cli, args, root);
  try {
    await Bun.write(path.join(root, "rope.toml"), policy);
    await Bun.write(path.join(root, "team/tsconfig.json"), "{}\n");
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    const checkout = checkoutAt(root);
    const before = await checkout.files();
    const index = await readFile(path.join(root, ".git/index"));

    const listed = await run("rules", "--json");
    expect(listed.exitCode).toBe(0);
    const report = RulesReportSchema.parse(JSON.parse(listed.stdout));
    expect(report.packs.find((pack) => pack.name === "config")?.state).toBe(
      "not-adopted"
    );
    const text = await run("rules");
    expect(text.stdout).toContain("rope rules adopt config");
    const unknown = await run("rules", "adopt", "missing", "--yes", "--json");
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain("Ropes ships no rule pack");
    const invalidList = await run("rules", "list", "--yes", "--json");
    expect(invalidList.exitCode).toBe(2);
    expect(await checkout.files()).toEqual(before);
    const preview = await run("rules", "adopt", "config", "--json");
    expect(preview.exitCode).toBe(0);
    const proposed = RulesAdoptReportSchema.parse(JSON.parse(preview.stdout));
    expect(proposed.adopted).toEqual(["config"]);
    expect(proposed.changed).toEqual(["rope.toml"]);
    expect(proposed.written).toBe(false);
    const dry = await run(
      "rules",
      "adopt",
      "config",
      "--yes",
      "--dry-run",
      "--json"
    );
    expect(dry).toEqual(preview);
    expect(await checkout.files()).toEqual(before);

    const apply = await run("rules", "adopt", "config", "--yes", "--json");
    expect(apply.exitCode).toBe(0);
    const applied = RulesAdoptReportSchema.parse(JSON.parse(apply.stdout));
    expect(applied.diff).toBe(proposed.diff);
    expect(applied.written).toBe(true);
    const after = await checkout.files();
    expect(
      Object.keys(after).filter((file) => after[file] !== before[file])
    ).toEqual(["rope.toml"]);
    const repeat = await run("rules", "adopt", "config", "--yes", "--json");
    expect(repeat.exitCode).toBe(0);
    expect(
      RulesAdoptReportSchema.parse(JSON.parse(repeat.stdout))
    ).toMatchObject({
      adopted: [],
      changed: [],
      written: false,
    });
    const explanation = await run("explain", "team/tsconfig.json", "--json");
    expect(explanation.exitCode).toBe(0);
    expect(explanation.stdout).toContain("config/tsconfig-extends");
    expect(await readFile(path.join(root, ".git/index"))).toEqual(index);

    await Bun.write(
      path.join(root, "rope.toml"),
      policy.replace('include = ["**/tsconfig.json"]', 'include = ["**/*.md"]')
    );
    const unreachable = await run("rules", "adopt", "config", "--json");
    expect(
      RulesAdoptReportSchema.parse(JSON.parse(unreachable.stdout)).notes.join(
        "\n"
      )
    ).toContain("will not run yet");
    await run("rules", "adopt", "config", "--yes", "--json");
    const excluded = await run("rules", "list", "--json");
    expect(
      RulesReportSchema.parse(JSON.parse(excluded.stdout)).notes.join("\n")
    ).toContain("leaves out");

    await rm(path.join(root, "rope.toml"));
    const missing = await run("rules", "adopt", "config", "--yes", "--json");
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("rope init");
    expect(await Bun.file(path.join(root, "cinch.toml")).exists()).toBe(false);
    await Bun.write(path.join(root, "cinch.toml"), policy);
    const legacy = await run("rules", "adopt", "config", "--yes", "--json");
    expect(legacy.exitCode).toBe(0);
    expect(
      RulesAdoptReportSchema.parse(JSON.parse(legacy.stdout)).changed
    ).toEqual(["cinch.toml"]);
    expect(await Bun.file(path.join(root, "rope.toml")).exists()).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("an adopted pack is checked through rope", async () => {
  if (Bun.which("ast-grep") === null) {
    if (process.env.CI === "true") {
      throw new Error("The public rule-pack proof requires ast-grep on PATH.");
    }
    console.warn(
      "skipped: ast-grep is required for the public rule-pack proof"
    );
    return;
  }
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-rules-check-"))
  );
  try {
    await Bun.write(path.join(root, "rope.toml"), policy);
    await Bun.write(path.join(root, "team/tsconfig.json"), "{}\n");
    await Bun.write(
      path.join(root, "mise.toml"),
      '[tools]\nast-grep = "0.51.3"\n'
    );
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    const adopted = await runEntry(
      cli,
      ["rules", "adopt", "config", "--yes"],
      root
    );
    expect(adopted.exitCode).toBe(0);
    const checked = await runEntry(
      cli,
      ["check", "team/tsconfig.json", "--json"],
      root
    );
    expect(checked.exitCode).toBe(1);
    expect(checked.stdout).toContain("config/tsconfig-extends");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
