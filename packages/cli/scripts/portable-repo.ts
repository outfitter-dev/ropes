import assert from "node:assert/strict";
import { mkdir, realpath, symlink } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePlan, parseResult } from "@ropes/core";

import core from "../../cinch/package.json" with { type: "json" };
import cli from "../package.json" with { type: "json" };
import { run } from "./packed-run.ts";
import { portableSnapshot } from "./portable-snapshot.ts";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));

const installedTool = async (name: string): Promise<string> => {
  const binary = Bun.which(name);
  assert.ok(
    binary !== null,
    `The portable proof requires pinned ${name} on PATH`
  );
  const resolved = await realpath(binary);
  const mise = Bun.which("mise");
  // Mise shims are links to mise itself. Resolve them before isolating HOME.
  if (mise === null || resolved !== (await realpath(mise))) {
    return resolved;
  }
  const target = await run([mise, "which", name], workspace);
  return await realpath(target.trim());
};

export const BASE = `pilot = 0
include = ["**/*.ts", "**/tsconfig.json"]
exclude = ["**/node_modules/**", "excluded/**"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
`;

export const portableRepo = async (
  folder: string,
  coreArchive: string,
  cliArchive: string
) => {
  const root = path.join(folder, "independent-repository");
  await mkdir(root);
  await run(["git", "init", "--quiet", "--template="], root);
  await Bun.write(
    path.join(root, "bunfig.toml"),
    '[install]\nlinker = "isolated"\n'
  );
  await Bun.write(
    path.join(root, "package.json"),
    JSON.stringify({
      dependencies: { [cli.name]: cliArchive },
      overrides: { [core.name]: coreArchive },
      private: true,
      type: "module",
    })
  );
  await run([process.execPath, "install", "--ignore-scripts"], root);
  await Bun.write(
    path.join(root, "package.json"),
    JSON.stringify({
      devDependencies: { [cli.name]: cli.version },
      private: true,
      type: "module",
    })
  );
  await Bun.write(path.join(root, ".gitignore"), "node_modules/\n");
  const launcher = path.join(root, "node_modules/.bin/rope");
  const executable = await realpath(launcher);
  const coreEntry = await realpath(
    Bun.resolveSync(core.name, path.dirname(executable))
  );
  const coreManifest = path.join(path.dirname(coreEntry), "..", "package.json");
  assert.ok(executable.startsWith(`${root}${path.sep}`));
  assert.ok(coreEntry.startsWith(`${root}${path.sep}`));
  assert.equal(
    await Bun.file(
      path.join(root, "node_modules/@ropes/core/package.json")
    ).exists(),
    false
  );
  const installedFiles = [
    "node_modules/.bin/rope",
    path.relative(root, executable),
    "node_modules/@ropes/cli/package.json",
    path.relative(root, coreManifest),
    path.relative(root, coreEntry),
  ];
  await run(["git", "add", "package.json", "bun.lock", ".gitignore"], root);
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
      "independent adopter",
    ],
    root
  );
  const home = path.join(folder, "portable-home");
  await mkdir(home);
  const tools = async (names: readonly string[]) => {
    const directory = path.join(folder, `portable-${names.join("-")}`);
    await mkdir(directory);
    await Promise.all(
      names.map(async (name) => {
        const binary = await installedTool(name);
        await symlink(binary, path.join(directory, name));
      })
    );
    return directory;
  };
  const invoke = async (
    args: readonly string[],
    searchPath: string,
    expected = 0
  ) => {
    const before = await portableSnapshot(root, installedFiles);
    const index = await Bun.file(path.join(root, ".git/index")).bytes();
    // A missing Bun on PATH is intentional in restricted-engine scenarios.
    const command =
      Bun.which("bun", { PATH: searchPath }) === null
        ? [process.execPath, executable, ...args]
        : [launcher, ...args];
    const child = Bun.spawn(command, {
      cwd: root,
      env: {
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
        HOME: home,
        PATH: searchPath,
        TMPDIR: folder,
        XDG_CACHE_HOME: path.join(home, "cache"),
        XDG_CONFIG_HOME: path.join(home, "config"),
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert.equal(code, expected, `${args.join(" ")}\n${stdout}\n${stderr}`);
    assert.equal(stderr, "");
    assert.deepEqual(await portableSnapshot(root, installedFiles), before);
    assert.deepEqual(
      await Bun.file(path.join(root, ".git/index")).bytes(),
      index
    );
    return stdout;
  };
  return {
    check: async (
      files: readonly string[],
      searchPath: string,
      expected = 0,
      at?: string
    ) => {
      const value = parseResult(
        JSON.parse(
          await invoke(
            [
              "check",
              ...files,
              "--strict",
              "--json",
              ...(at === undefined ? [] : ["--at", at]),
            ],
            searchPath,
            expected
          )
        )
      );
      if (!value.ok) {
        throw new Error(JSON.stringify(value.error));
      }
      return value.value;
    },
    explain: async (
      files: readonly string[],
      searchPath: string,
      at?: string
    ) => {
      const value = parsePlan(
        JSON.parse(
          await invoke(
            [
              "explain",
              ...files,
              "--strict",
              "--json",
              ...(at === undefined ? [] : ["--at", at]),
            ],
            searchPath
          )
        )
      );
      if (!value.ok) {
        throw new Error(JSON.stringify(value.error));
      }
      return value.value;
    },
    root,
    text: invoke,
    tools,
    write: (file: string, text: string) =>
      Bun.write(path.join(root, file), text),
  };
};
export type PortableRepo = Awaited<ReturnType<typeof portableRepo>>;
