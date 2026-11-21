import assert from "node:assert/strict";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BASE } from "./portable-repo.ts";
import type { PortableRepo } from "./portable-repo.ts";

const RULE = "typescript-api/removed-map";
const FILE = "api/index.ts";
const BEFORE = "2099-01-31T23:59:59.999Z";
const BOUNDARY = "2099-02-01T00:00:00.000Z";
const source =
  'import type { Map as LegacyMap } from "typescript";\nexport type Legacy = LegacyMap<string>;\n';

/** Install the pinned official declarations before checks run offline. */
const declarations = async (root: string) => {
  const original = path.dirname(
    fileURLToPath(import.meta.resolve("typescript-5-0/package.json"))
  );
  const installed = path.join(root, "api/node_modules/typescript");
  await mkdir(path.join(installed, "lib"), { recursive: true });
  await Promise.all(
    ["package.json", "lib/typescript.d.ts"].map((file) =>
      copyFile(path.join(original, file), path.join(installed, file))
    )
  );
};

export const provePortablePolicy = async (repo: PortableRepo) => {
  const onlyGit = await repo.tools(["git"]);
  await repo.write(FILE, source);
  const defaults = await repo.explain([FILE], onlyGit);
  assert.equal(defaults.rules, undefined);
  assert.deepEqual(defaults.batches, []);
  await repo.write("rope.toml", BASE);
  const plain = await repo.check([FILE], onlyGit);
  assert.deepEqual(plain.steps, []);
  assert.equal(plain.plan.rules, undefined);

  await declarations(repo.root);
  await repo.write(
    "api/package.json",
    JSON.stringify({ peerDependencies: { typescript: "^5.0.0" } })
  );
  await repo.write(
    "api/tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        skipLibCheck: true,
      },
    })
  );
  const policy = `${BASE}[rules]\nenabled = true\npacks = ["typescript-api"]\n[rules.enforcement]\n"${RULE}" = "2099-02-01"\n`;
  await repo.write("rope.toml", policy);
  const tools = await repo.tools(["git", "bun"]);
  const early = await repo.check([FILE], tools, 0, BEFORE);
  assert.equal(early.outcome, "clean");
  assert.deepEqual(early.plan, await repo.explain([FILE], tools, BEFORE));
  assert.deepEqual(early.plan.evaluation, {
    at: BEFORE,
    nextTransitionAt: BOUNDARY,
    simulated: true,
  });
  const [finding] = early.steps.flatMap(({ findings }) => findings);
  assert.ok(finding);
  assert.ok(finding.enforcement);
  assert.equal(finding.rule, RULE);
  assert.equal(finding.nativeRule, "TS2305");
  assert.equal(finding.enforcement.level, "advisory");
  assert.deepEqual(finding.enforcement.source, {
    file: "rope.toml",
    key: `rules.enforcement.${RULE}`,
    kind: "file",
  });
  const [planned] = early.plan.paths;
  assert.ok(planned);
  const [target] = planned.targets ?? [];
  assert.ok(target);
  assert.ok(target.fact);
  assert.equal(planned.package, "api");
  assert.equal(target.fact.source.file, "api/package.json");
  assert.equal(target.decision, "applicable");
  const late = await repo.check([FILE], tools, 1, BOUNDARY);
  assert.equal(
    late.steps.flatMap(({ findings }) => findings)[0]?.enforcement?.level,
    "blocking"
  );
  const human = await repo.text(
    ["check", FILE, "--strict", "--at", BOUNDARY],
    tools,
    1
  );
  assert.ok(human.includes(RULE));
  assert.ok(human.includes("Exit code 1"));
  assert.ok(human.includes(BOUNDARY));
  await repo.write(
    "api/package.json",
    JSON.stringify({ peerDependencies: { typescript: "^4.9.0" } })
  );
  const old = await repo.check([FILE], onlyGit, 0, BOUNDARY);
  assert.deepEqual(old.steps, []);
  assert.equal(old.plan.paths[0]?.targets?.[0]?.decision, "inapplicable");
  assert.equal(old.plan.evaluation?.nextTransitionAt, undefined);
  await repo.write(
    "api/package.json",
    JSON.stringify({ peerDependencies: { typescript: "^5.0.0" } })
  );
  const unavailable = await repo.check([FILE], onlyGit, 2, BOUNDARY);
  assert.equal(unavailable.outcome, "incomplete");
  await repo.write("excluded/index.ts", source);
  const excluded = await repo.check(["excluded/index.ts"], onlyGit, 0, BEFORE);
  assert.deepEqual(excluded.steps, []);
  assert.equal(excluded.plan.paths[0]?.skipped?.reason, "excluded");
  assert.equal(excluded.plan.evaluation?.nextTransitionAt, undefined);
  console.log(
    "Portable neutral policy preserved package facts, deadline provenance, exclusions, and exits 0/1/2."
  );
};
