import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import core from "../../cinch/package.json" with { type: "json" };
import cli from "../package.json" with { type: "json" };
import { checkFiles } from "./packed-contents.ts";
import { provePortable } from "./packed-portable.ts";
import { run } from "./packed-run.ts";
import { smoke } from "./packed-smoke.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const tool = (name: string, args: readonly string[]): Promise<string> =>
  run(
    [process.execPath, path.join(ROOT, "node_modules/.bin", name), ...args],
    ROOT
  );

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
