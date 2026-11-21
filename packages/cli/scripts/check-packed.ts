import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import core from "../../cinch/package.json" with { type: "json" };
import cli from "../package.json" with { type: "json" };
import fixture from "../tests/fixtures/outfitter/package.json" with { type: "json" };
import { packConsumer, proveConsumer } from "./packed-consumer.ts";
import { checkFiles } from "./packed-contents.ts";
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

if (
  core.version !== cli.version ||
  core.publishConfig.tag !== cli.publishConfig.tag
) {
  throw new Error(
    "The CLI and core artifacts must match in version and npm tag"
  );
}
const releaseVersion = String.raw`(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){2}`;
const { tag } = core.publishConfig;
const suffix = tag === "canary" ? String.raw`-canary\.(?:0|[1-9][0-9]*)` : "";
if (
  (tag !== "canary" && tag !== "latest") ||
  !new RegExp(`^${releaseVersion}${suffix}$`, "u").test(core.version)
) {
  throw new Error(
    `The npm tag ${tag} does not match release version ${core.version}`
  );
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
    [
      "LICENSE",
      "README.md",
      "package.json",
      "src",
      "presets",
      "rules",
      "schemas",
    ],
    [
      "LICENSE",
      "README.md",
      "src/index.ts",
      "src/render/index.ts",
      "presets/rumdl.toml",
      "rules/config/pack.toml",
      "schemas/cinch.schema.json",
    ]
  );
  await checkFiles(
    cliArchive,
    ["LICENSE", "README.md", "package.json", "src"],
    ["LICENSE", "README.md", "src/cli.ts"]
  );
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
  const output = process.env.ROPES_PACKED_OUTPUT;
  if (output !== undefined) {
    await mkdir(output);
    try {
      await copyFile(coreArchive, path.join(output, "core.tgz"));
      await copyFile(cliArchive, path.join(output, "cli.tgz"));
    } catch (error) {
      await rm(output, { force: true, recursive: true });
      throw error;
    }
  }
  console.log(
    "Packed CLI and core passed lint, types, and external consumer checks."
  );
} finally {
  await rm(scratch, { force: true, recursive: true });
}
