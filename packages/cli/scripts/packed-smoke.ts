import assert from "node:assert/strict";
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import workspace from "../../../package.json" with { type: "json" };
import core from "../../cinch/package.json" with { type: "json" };
import cli from "../package.json" with { type: "json" };
import fixture from "../tests/fixtures/outfitter/package.json" with { type: "json" };
import { packConsumer, proveConsumer } from "./packed-consumer.ts";
import { proveDelegation } from "./packed-delegation.ts";
import { run } from "./packed-run.ts";

const decode = (text: string): unknown => JSON.parse(text);

export const smoke = async (
  folder: string,
  coreArchive: string,
  cliArchive: string
) => {
  const consumer = path.join(folder, "consumer");
  const fixtureArchive = await packConsumer(folder);
  const devDependencies = {
    "@types/bun": workspace.devDependencies["@types/bun"],
  };
  await mkdir(consumer);
  await run(["git", "init", "--quiet", "--template="], consumer);
  await Bun.write(
    path.join(consumer, "package.json"),
    JSON.stringify({
      dependencies: {
        [core.name]: coreArchive,
        [cli.name]: cliArchive,
        [fixture.name]: fixtureArchive,
      },
      devDependencies,
      // The consumer and CLI can both reference an unpublished core version.
      overrides: { [core.name]: coreArchive },
      private: true,
      type: "module",
    })
  );
  await run([process.execPath, "install", "--ignore-scripts"], consumer);
  await Promise.all(
    [core.name, cli.name].map(async (name) => {
      const installed = await realpath(
        path.join(consumer, "node_modules", name)
      );
      if (!installed.startsWith(`${consumer}${path.sep}`)) {
        throw new Error(
          `The external consumer linked ${name} outside its install`
        );
      }
    })
  );
  const installedCore: unknown = await Bun.file(
    path.join(consumer, "node_modules", core.name, "package.json")
  ).json();
  const installedCli: unknown = await Bun.file(
    path.join(consumer, "node_modules", cli.name, "package.json")
  ).json();
  if (
    typeof installedCore !== "object" ||
    installedCore === null ||
    !("version" in installedCore) ||
    installedCore.version !== core.version ||
    typeof installedCli !== "object" ||
    installedCli === null ||
    !("dependencies" in installedCli) ||
    typeof installedCli.dependencies !== "object" ||
    installedCli.dependencies === null ||
    Object.entries(installedCli.dependencies).find(
      ([name]) => name === core.name
    )?.[1] !== core.version
  ) {
    throw new Error(
      "The packed CLI must depend on the exact packed core version"
    );
  }
  const executable = path.join(consumer, "node_modules/.bin/rope");
  await Bun.write(
    path.join(consumer, "package.json"),
    JSON.stringify({
      dependencies: {
        [core.name]: core.version,
        [cli.name]: cli.version,
        [fixture.name]: fixture.version,
      },
      devDependencies,
      private: true,
      type: "module",
    })
  );
  await run(["git", "add", "package.json"], consumer);
  await run(
    [
      "git",
      "-c",
      "user.name=Ropes",
      "-c",
      "user.email=ropes@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--message",
      "packed consumer",
    ],
    consumer
  );
  const version = await run([executable, "--version"], consumer);
  if (version.trim() !== `rope ${cli.version}\n${await realpath(executable)}`) {
    throw new Error(`Unexpected rope version ${version}`);
  }
  await Bun.write(
    path.join(consumer, "README.md"),
    "# Packed consumer\n\nText.\n"
  );
  const config = path.join(consumer, "rope.toml");
  const managed = path.join(consumer, ".ropes");
  const preview = await run([executable, "init", "--json"], consumer);
  assert.ok(preview.includes(".ropes/configs/"));
  assert.equal(await Bun.file(config).exists(), false);
  const index = Bun.file(path.join(consumer, ".git/index"));
  const before = await index.bytes();
  await run([executable, "init", "--yes"], consumer);
  assert.equal(await Bun.file(config).exists(), true);
  await run([executable, "check", "README.md", "--json"], consumer);
  assert.deepEqual(await index.bytes(), before);
  await rm(config);
  await rm(managed, { recursive: true });
  await rm(path.join(consumer, ".rumdl.toml"));
  await Bun.write(path.join(consumer, "cinch.toml"), "pilot = 0\n");
  const presets = await run([executable, "preset", "--json"], consumer, {
    exitCode: 1,
  });
  if (!presets.includes(".outfitter/configs/presets/rumdl.toml")) {
    throw new Error(
      "The packed preset command did not preserve legacy managed paths"
    );
  }
  await Bun.write(
    path.join(consumer, "explain.ts"),
    `
import { explain, parsePlan } from "@ropes/core";
const result = await explain({ cwd: process.cwd(), paths: ["README.md"] });
if (!result.ok) throw new Error(result.error);
const parsed = parsePlan(result.value.plan);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
console.log(JSON.stringify(parsed.value));
`
  );
  await Bun.write(
    path.join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: "Preserve",
        moduleResolution: "Bundler",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "ESNext",
        types: ["bun"],
      },
      include: ["explain.ts"],
    })
  );
  await run([process.execPath, "check", "--no-script"], consumer);
  console.log("The external consumer type-checked against packed core.");
  const api = decode(await run([process.execPath, "explain.ts"], consumer));
  const command = decode(
    await run([executable, "explain", "README.md", "--json"], consumer)
  );
  if (JSON.stringify(api) !== JSON.stringify(command)) {
    throw new Error(
      "The packed CLI and public core API produced different plans"
    );
  }
  const configSchema = await run([executable, "schema", "config"], consumer);
  if (!configSchema.includes('"title": "rope.toml"')) {
    throw new Error("Packed rope did not emit the Ropes config schema");
  }
  await proveConsumer(consumer);
  await proveDelegation(folder, consumer);
};
