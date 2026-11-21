import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import manifest from "../package.json" with { type: "json" };
import { taploAdapter } from "../src/adapters/taplo/adapter.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { parsePlan } from "../src/contracts/parse.ts";
import { explain } from "../src/index.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { renderPlan } from "../src/render/plan.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ropes-recovery-plan-"));
  await mkdir(path.join(root, ".git"));
  await Bun.write(path.join(root, "rope.toml"), "pilot = 0\n");
  await Bun.write(path.join(root, "mise.toml"), '[tools]\ntaplo = "0.10.0"\n');
  await Bun.write(path.join(root, "sample.toml"), 'name = "ropes"\n');
});

afterAll(() => rm(root, { force: true, recursive: true }));

test("strict explain declares bundled recovery beside the native Taplo pin", async () => {
  const explained = await explain({
    cwd: root,
    paths: ["sample.toml"],
    strict: true,
  });
  if (!explained.ok) {
    throw new Error(explained.error);
  }
  const { plan } = explained.value;
  const native = plan.paths[0]?.steps.find(
    ({ adapter }) => adapter === "taplo"
  );
  expect(native?.versionRange).toBe("0.10.0");
  expect(native?.tolerates).toBeUndefined();
  expect(native?.recovery).toEqual({
    package: `@taplo/cli@${manifest.dependencies["@taplo/cli"]}`,
    platform: "darwin",
    tool: "Taplo WebAssembly",
    version: "0.9.0",
    when: "native Taplo panics in macOS SystemConfiguration proxy discovery",
  });
  expect(
    plan.batches.find(({ adapter }) => adapter === "taplo")?.recovery
  ).toEqual(native?.recovery);
  const serialized = JSON.stringify(plan);
  const parsed = parsePlan(JSON.parse(serialized));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.value).toEqual(plan);
  }
  const human = renderPlan(plan, { configFile: "rope.toml", tools: [] });
  expect(human).toContain("taplo 0.10.0");
  expect(human).toContain(
    "recovery  Taplo WebAssembly 0.9.0 (@taplo/cli@0.7.0) on darwin"
  );
  expect(human).toContain(
    "when native Taplo panics in macOS SystemConfiguration proxy discovery"
  );
});

test("rope explain exposes conditional recovery in JSON and human output", async () => {
  const cli = new URL("../../cli/src/cli.ts", import.meta.url).pathname;
  const invoke = async (args: readonly string[]) => {
    const child = Bun.spawn(
      [process.execPath, cli, "explain", "sample.toml", "--strict", ...args],
      { cwd: root, stderr: "pipe", stdout: "pipe" }
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(stderr).toBe("");
    return stdout;
  };
  const json = parsePlan(JSON.parse(await invoke(["--json"])));
  expect(json.ok).toBe(true);
  if (json.ok) {
    expect(
      json.value.batches.find(({ adapter }) => adapter === "taplo")?.recovery
        ?.version
    ).toBe("0.9.0");
  }
  const human = await invoke([]);
  expect(human).toContain("Taplo WebAssembly 0.9.0 (@taplo/cli@0.7.0)");
  expect(human).toContain(
    "when native Taplo panics in macOS SystemConfiguration proxy discovery"
  );
});

test("plans without recovery metadata retain their existing schema", () => {
  const { recovery: _recovery, ...descriptor } = taploAdapter().descriptor;
  const plan = resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: [descriptor],
    packages: [],
    paths: ["sample.toml"],
    root: "/repo",
    selection: { kind: "paths", paths: ["sample.toml"] },
  });
  expect(plan.paths[0]?.steps[0]?.recovery).toBeUndefined();
  expect(plan.batches[0]?.recovery).toBeUndefined();
  const parsed = parsePlan(plan);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.value).toEqual(plan);
  }
  expect(renderPlan(plan, { configFile: null, tools: [] })).not.toContain(
    "recovery"
  );
});
