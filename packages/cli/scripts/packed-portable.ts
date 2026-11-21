import assert from "node:assert/strict";
import path from "node:path";

import { provePortablePolicy } from "./portable-policy.ts";
import { BASE, portableRepo } from "./portable-repo.ts";

/** Exercise installed artifacts in an unrelated repository with a small environment. */
export const provePortable = async (
  folder: string,
  coreArchive: string,
  cliArchive: string
) => {
  const repo = await portableRepo(folder, coreArchive, cliArchive);
  const pins = await Bun.file(
    new URL("../../../mise.toml", import.meta.url)
  ).text();
  await repo.write("mise.toml", pins);
  await provePortablePolicy(repo);
  const tools = await repo.tools(["git", "ast-grep"]);
  await repo.write("own/index.ts", "debugger;\n");
  await repo.write(
    "rules/no-debugger.yml",
    `id: no-debugger
language: typescript
severity: error
message: Remove the debugger before sharing this code.
rule:
  pattern: debugger
`
  );
  await repo.write(
    "rope.toml",
    `${BASE}[rules]\nenabled = true\nlocal = ["rules"]\n`
  );
  const local = await repo.check(["own/index.ts"], tools, 1);
  assert.equal(local.steps[0]?.findings[0]?.rule, "local/no-debugger");
  assert.equal(local.plan.localRules?.[0]?.source.kind, "file");
  assert.deepEqual(
    local.plan.rules?.map(({ named }) => named).filter(Boolean),
    []
  );
  assert.equal(local.plan.batches[0]?.tool, "ast-grep");
  const explain = await repo.text(
    ["explain", "own/index.ts", "--strict"],
    tools
  );
  assert.ok(explain.includes("rules.local"));
  assert.ok(explain.includes("rope.toml"));

  await repo.write("team/tsconfig.json", "{}\n");
  await repo.write("rope.toml", BASE);
  const unadopted = await repo.explain(["team/tsconfig.json"], tools);
  assert.deepEqual(unadopted.batches, []);
  await repo.write(
    "rope.toml",
    `${BASE}[rules]\nenabled = true\npacks = ["config"]\n[typescript]\npreset = true\n`
  );
  const preset = await repo.explain([], tools);
  assert.ok(
    preset.paths.some(
      ({ path: file, layer }) =>
        file === ".ropes/configs/presets/tsconfig.json" && layer === "preset"
    )
  );
  assert.ok(
    preset.paths.some(({ policy }) =>
      policy.some(
        ({ key, source }) =>
          key === "typescript.preset" &&
          source.kind === "file" &&
          source.file === "rope.toml"
      )
    )
  );
  const adopted = await repo.check(["team/tsconfig.json"], tools, 1);
  assert.equal(adopted.steps[0]?.findings[0]?.rule, "config/tsconfig-extends");
  assert.deepEqual(
    adopted.plan.rules?.find(({ name }) => name === "config")?.named,
    { file: "rope.toml", key: "rules.packs", kind: "file" }
  );
  const version = await repo.text(["--version"], tools);
  assert.ok(version.includes(path.join(repo.root, "node_modules")));
  console.log(
    "Portable packed CLI ran a repository-owned rule and explicitly adopted config policy outside the Ropes source checkout."
  );
};
