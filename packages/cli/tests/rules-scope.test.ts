import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  RulesAdoptReportSchema,
  RulesReportSchema,
} from "../../core/src/contracts/rules-report.ts";
import { fixtureGit, runEntry } from "../../core/tests/acceptance-repo.ts";

const cli = new URL("../src/cli.ts", import.meta.url);
const base = `pilot = 0
include = ["**/tsconfig.json"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
`;

test("public pack adoption preserves an override-only rollout", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "rules-scope-"))
  );
  try {
    await fixtureGit(root, "init", "--quiet");
    await Bun.write(
      path.join(root, "rope.toml"),
      `${base}
[[overrides]]
paths = ["ready/**"]
[overrides.rules]
enabled = true
`
    );
    for (const folder of ["ready", "waiting"]) {
      // eslint-disable-next-line no-await-in-loop -- create both rollout scopes
      await Bun.write(path.join(root, folder, "tsconfig.json"), "{}\n");
    }
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    const adopted = await runEntry(
      cli,
      ["rules", "adopt", "config", "--yes"],
      root
    );
    expect(adopted.exitCode).toBe(0);
    const policy = Bun.TOML.parse(
      await Bun.file(path.join(root, "rope.toml")).text()
    );
    expect(policy).toMatchObject({ rules: { packs: ["config"] } });
    expect(policy).not.toHaveProperty("rules.enabled");
    const planned = await runEntry(
      cli,
      ["explain", "ready/tsconfig.json", "waiting/tsconfig.json", "--json"],
      root
    );
    expect(planned.exitCode).toBe(0);
    expect(planned.stdout).toContain("config/tsconfig-extends");
    const waiting = await runEntry(
      cli,
      ["explain", "waiting/tsconfig.json", "--json"],
      root
    );
    expect(waiting.exitCode).toBe(0);
    expect(JSON.parse(waiting.stdout)).toMatchObject({ batches: [] });

    await Bun.write(
      path.join(root, "rope.toml"),
      `${base}
[rules]
enabled = true
packs = ["config"]
[[overrides]]
paths = ["**/tsconfig.json"]
[overrides.rules]
enabled = false
`
    );
    const listed = await runEntry(cli, ["rules", "--json"], root);
    expect(listed.exitCode).toBe(0);
    const report = RulesReportSchema.parse(JSON.parse(listed.stdout));
    expect(report.packs.find((pack) => pack.name === "config")?.state).toBe(
      "not-enabled"
    );
    expect(report.notes.join("\n")).toContain(
      "disabled on every selected file"
    );
    const text = await runEntry(cli, ["rules"], root);
    expect(text.stdout).toContain("config  not enabled on its selected files");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test.each([
  { name: "implicit enablement", policy: base, warning: "" },
  {
    name: "explicitly disabled rules",
    policy: `${base}[rules]\nenabled = false\n`,
    warning: "disabled on every selected file",
  },
  {
    name: "disabled override scope",
    policy: `${base}[[overrides]]\npaths = ["**/tsconfig.json"]\n[overrides.rules]\nenabled = false\n`,
    warning: "disabled on every selected file",
  },
  {
    name: "excluded files",
    policy: base.replace(
      "pilot = 0",
      'pilot = 0\nexclude = ["**/tsconfig.json"]'
    ),
    warning: "leaves out",
  },
])(
  "adoption preview and apply report $name after the proposed edit",
  async (given) => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "rules-warning-"))
    );
    try {
      const config = Bun.file(path.join(root, "rope.toml"));
      await fixtureGit(root, "init", "--quiet");
      await Bun.write(config, given.policy);
      await Bun.write(path.join(root, "tsconfig.json"), "{}\n");
      await fixtureGit(root, "add", ".");
      await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
      const preview = await runEntry(
        cli,
        ["rules", "adopt", "config", "--json"],
        root
      );
      expect(preview.exitCode).toBe(0);
      const proposed = RulesAdoptReportSchema.parse(JSON.parse(preview.stdout));
      expect(await config.text()).toBe(given.policy);
      const apply = await runEntry(
        cli,
        ["rules", "adopt", "config", "--yes", "--json"],
        root
      );
      expect(apply.exitCode).toBe(0);
      const applied = RulesAdoptReportSchema.parse(JSON.parse(apply.stdout));
      expect(applied.diff).toBe(proposed.diff);
      expect(applied.notes).toEqual(proposed.notes);
      if (given.warning === "") {
        expect(applied.notes).toEqual([]);
        expect(Bun.TOML.parse(await config.text())).toMatchObject({
          rules: { enabled: true, packs: ["config"] },
        });
        const plan = await runEntry(
          cli,
          ["explain", "tsconfig.json", "--json"],
          root
        );
        expect(plan.exitCode).toBe(0);
        expect(plan.stdout).toContain("config/tsconfig-extends");
      } else {
        expect(applied.notes.join("\n")).toContain(given.warning);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
);
