import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import { createCommands } from "../src/commands/registry.ts";
import { DoctorReportSchema } from "../src/contracts/doctor.ts";
import { doctor } from "../src/index.ts";
import { fixtureGit, runEntry } from "./acceptance-repo.ts";
import { snapshot } from "./repo-bench.ts";

const CLI = new URL("../../cli/src/cli.ts", import.meta.url);
const POLICY = `pilot = 0
include = ["README.md", "a.ts"]
[markdown]
preset = false
[toml]
enabled = false
[format]
enabled = true
preset = false
[editor]
line_width = 100
`;

const inRepo = async (body: (root: string) => Promise<void>) => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "doctor-settings-"))
  );
  try {
    await Bun.write(path.join(root, "rope.toml"), POLICY);
    await Bun.write(path.join(root, "README.md"), "# Guide\n");
    await Bun.write(path.join(root, "a.ts"), "const a = 1;\n");
    await Bun.write(
      path.join(root, ".rumdl.toml"),
      "[global]\nline-length = 100\n"
    );
    await Bun.write(path.join(root, ".oxfmtrc.json"), '{"printWidth":100}\n');
    await Bun.write(path.join(root, ".prettierrc.json"), '{"printWidth":47}\n');
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    const legacy = createCommands({ adapters: adaptersFor });
    await legacy.doctor?.({ cwd: root, fix: true, json: true, paths: [] });
    await fixtureGit(root, "add", ".");
    await fixtureGit(
      root,
      "commit",
      "--quiet",
      "--allow-empty",
      "--message",
      "setup"
    );
    await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("read-only rope doctor reports shared policy, observed sources, and active drift", async () => {
  if (Bun.which("rumdl") === null) {
    console.warn(
      "skipped: rumdl is required for doctor’s native settings proof"
    );
    return;
  }
  await inRepo(async (root) => {
    const before = await snapshot(root);
    const indexBefore = await readFile(path.join(root, ".git/index"));
    const configBefore = await readFile(path.join(root, ".oxfmtrc.json"));
    const clean = await runEntry(CLI, ["doctor", "--json"], root);
    expect(clean.exitCode).toBe(0);
    const report = DoctorReportSchema.parse(JSON.parse(clean.stdout));
    expect(report.settings?.stated).toContainEqual({
      file: "rope.toml",
      key: "editor.line_width",
      name: "line_width",
      value: 100,
    });
    const observed = report.settings?.observations ?? [];
    expect(
      observed.find((observation) => observation.adapter === "rumdl")?.facts[0]
    ).toMatchObject({ evidence: "engine-confirmed", value: 100 });
    expect(
      observed.find((observation) => observation.adapter === "bun-fmt")
        ?.facts[0]
    ).toMatchObject({
      evidence: "config-read",
      file: ".oxfmtrc.json",
      value: 100,
    });
    expect(report.settings?.steps).toEqual([]);
    expect(await snapshot(root)).toEqual(before);
    const human = await runEntry(CLI, ["doctor"], root);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("engine-confirmed");
    expect(human.stdout).toContain("config-read");
    expect(human.stdout).toContain("does not expose its resolved printWidth");
    expect(await readFile(path.join(root, ".git/index"))).toEqual(indexBefore);
    expect(await readFile(path.join(root, ".oxfmtrc.json"))).toEqual(
      configBefore
    );

    await Bun.write(path.join(root, ".oxfmtrc.json"), '{"printWidth":120}\n');
    const driftBefore = await snapshot(root);
    const driftIndexBefore = await readFile(path.join(root, ".git/index"));
    const driftConfigBefore = await readFile(path.join(root, ".oxfmtrc.json"));
    const drift = await runEntry(CLI, ["doctor", "--json"], root);
    expect(drift.exitCode).toBe(1);
    const changed = DoctorReportSchema.parse(JSON.parse(drift.stdout));
    expect(changed.settings?.steps[0]).toMatchObject({
      adapter: "bun-fmt",
      findings: [{ path: ".oxfmtrc.json", rule: "shared-fact/line_width" }],
      status: "findings",
    });
    const plain = await runEntry(CLI, ["doctor"], root);
    expect(plain.stdout).toContain(".oxfmtrc.json sets `printWidth` to 120");
    expect(plain.stdout).toContain("rope.toml sets `editor.line_width` to 100");
    expect(await snapshot(root)).toEqual(driftBefore);
    expect(await readFile(path.join(root, ".git/index"))).toEqual(
      driftIndexBefore
    );
    expect(await readFile(path.join(root, ".oxfmtrc.json"))).toEqual(
      driftConfigBefore
    );
  });
});

test("public doctor preserves unavailable and unobservable settings limits", async () => {
  if (Bun.which("rumdl") === null) {
    console.warn(
      "skipped: rumdl is required for doctor’s native settings proof"
    );
    return;
  }
  await inRepo(async (root) => {
    await rm(path.join(root, ".oxfmtrc.json"));
    await rm(path.join(root, ".prettierrc.json"));
    await Bun.write(
      path.join(root, "prettier.config.js"),
      'import {writeFileSync} from "node:fs"; writeFileSync("sentinel", "executed"); export default {printWidth: 120};\n'
    );
    const inspected = await doctor({ cwd: root, paths: [] });
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      const limited = inspected.value.settings?.observations.find(
        (observation) => observation.adapter === "bun-fmt"
      );
      expect(limited?.facts).toEqual([]);
      expect(limited?.limitations.join("\n")).toContain(
        "native discovery may execute"
      );
    }
    expect(await Bun.file(path.join(root, "sentinel")).exists()).toBe(false);
    const noTools = await runEntry(CLI, ["doctor", "--json"], root, "");
    expect(noTools.exitCode).toBe(2);
    const report = DoctorReportSchema.parse(JSON.parse(noTools.stdout));
    expect(report.tools.some((tool) => tool.problem !== undefined)).toBe(true);
  });
});

test("rope doctor rejects content paths and write-only options", async () => {
  await inRepo(async (root) => {
    for (const args of [
      ["doctor", "a.ts"],
      ["doctor", "--fix"],
      ["doctor", "--dry-run"],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- each CLI shape must fail without writes
      const ran = await runEntry(CLI, args, root);
      expect(ran.exitCode).toBe(2);
    }
  });
});
