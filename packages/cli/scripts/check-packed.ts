import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import core from "../../cinch/package.json" with { type: "json" };
import cli from "../package.json" with { type: "json" };
import fixture from "../tests/fixtures/outfitter/package.json" with { type: "json" };
import { packConsumer, proveConsumer } from "./packed-consumer.ts";
import { proveDelegation } from "./packed-delegation.ts";
import { provePortable } from "./packed-portable.ts";
import { run } from "./packed-run.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const decode = (text: string): unknown => JSON.parse(text);

const tool = (name: string, args: readonly string[]): Promise<string> =>
  run(
    [process.execPath, path.join(ROOT, "node_modules/.bin", name), ...args],
    ROOT
  );

const checkFiles = async (
  archive: string,
  allowed: readonly string[],
  required: readonly string[]
) => {
  const listing = await run(["tar", "-tzf", archive], ROOT);
  const files = listing
    .trim()
    .split("\n")
    .filter((file) => !file.endsWith("/"));
  for (const file of files) {
    const relative = file.replace(/^package\//u, "");
    if (
      !allowed.some(
        (prefix) => relative === prefix || relative.startsWith(`${prefix}/`)
      )
    ) {
      throw new Error(`Unexpected packed file ${file}`);
    }
  }
  for (const file of required) {
    if (!files.includes(`package/${file}`)) {
      throw new Error(`The tarball is missing ${file}`);
    }
  }
};

const smoke = async (
  folder: string,
  coreArchive: string,
  cliArchive: string
) => {
  const consumer = path.join(folder, "consumer");
  const fixtureArchive = await packConsumer(folder);
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
  await Bun.write(path.join(consumer, "cinch.toml"), "pilot = 0\n");
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
  const api = decode(await run([process.execPath, "explain.ts"], consumer));
  const command = decode(
    await run([executable, "explain", "README.md", "--json"], consumer)
  );
  if (JSON.stringify(api) !== JSON.stringify(command)) {
    throw new Error(
      "The packed CLI and public core API produced different plans"
    );
  }
  await proveConsumer(consumer);
  await proveDelegation(folder, consumer);
};

if (core.version !== cli.version) {
  throw new Error("The CLI and core artifacts must have matching versions");
}
const scratch = await realpath(
  await mkdtemp(path.join(tmpdir(), "ropes-packed-"))
);
try {
  const coreArchive = path.join(scratch, "core.tgz");
  const cliArchive = path.join(scratch, "cli.tgz");
  await run(
    [
      process.execPath,
      "pm",
      "pack",
      "--ignore-scripts",
      "--filename",
      coreArchive,
    ],
    path.join(ROOT, "packages/cinch")
  );
  await run(
    [
      process.execPath,
      "pm",
      "pack",
      "--ignore-scripts",
      "--filename",
      cliArchive,
    ],
    path.join(ROOT, "packages/cli")
  );
  await checkFiles(
    coreArchive,
    ["package.json", "src", "presets", "rules", "schemas"],
    [
      "src/index.ts",
      "src/render/index.ts",
      "presets/rumdl.toml",
      "rules/config/pack.toml",
      "schemas/cinch.schema.json",
    ]
  );
  await checkFiles(cliArchive, ["package.json", "src"], ["src/cli.ts"]);
  const coreFiles = await run(["tar", "-tzf", coreArchive], ROOT);
  if (coreFiles.split("\n").includes("package/src/cli.ts")) {
    throw new Error("The core tarball contains the legacy Cinch entry point");
  }
  console.log(await tool("publint", [coreArchive, "--strict"]));
  console.log(await tool("publint", [cliArchive, "--strict"]));
  console.log(
    await tool("attw", [
      coreArchive,
      "--no-definitely-typed",
      "--profile",
      "esm-only",
    ])
  );
  await smoke(scratch, coreArchive, cliArchive);
  await provePortable(scratch, coreArchive, cliArchive);
  console.log(
    "Packed CLI and core passed lint, types, and external consumer checks."
  );
} finally {
  await rm(scratch, { force: true, recursive: true });
}
