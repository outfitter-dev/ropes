import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import manifest from "../package.json" with { type: "json" };
import { nativeCommand } from "../src/adapters/taplo/wasm.ts";
import { qualifyStandaloneCache } from "./binary-cache.ts";
import { qualifyMiseInstall } from "./binary-install.ts";
import { qualifyStandaloneTaplo } from "./binary-taplo.ts";

const BUILD = new URL("../scripts/build-binary.ts", import.meta.url).pathname;
const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
const SHIPPED = new URL("../presets/rumdl.toml", import.meta.url);
const KEPT = ".outfitter/configs/presets/rumdl.toml";
const README = "# Guide\n\n# Second title\n\nText.\n";

const FENCES =
  "# Guide\n\n```ts\nconst  a = 1\n```\n\n```js\nconst  b = 2\n```\n";
const FORMATTED =
  "# Guide\n\n```ts\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```\n";

let dir = "";
let binary = "";
let toolPath = "";

beforeAll(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-bin-")));
  binary = path.join(dir, "cinch");
  toolPath = path.join(dir, "engines");
  await mkdir(toolPath);
  await Promise.all(
    ["rumdl", "taplo", "git", "ast-grep"].map(async (name) => {
      const found =
        name === "taplo" ? await nativeCommand(name) : Bun.which(name);
      if (found === null) {
        if (process.env.CI === "true") {
          throw new Error(`The standalone CI proof requires ${name} on PATH.`);
        }
        return;
      }
      await symlink(await realpath(found), path.join(toolPath, name));
    })
  );
  const built = Bun.spawn(["bun", BUILD, binary], {
    stderr: "pipe",
    stdout: "ignore",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(built.stderr).text(),
    built.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`bun ${BUILD} ${binary} exited ${exitCode}\n${stderr}`);
  }
});

afterAll(() => rm(dir, { force: true, recursive: true }));

/** A search path with the engines and Git on it, and no Bun. */
const withoutBun = (): string | null => {
  const found = ["rumdl", "taplo", "git"].every(
    (name) => Bun.which(name, { PATH: toolPath }) !== null
  );
  return found && Bun.which("bun", { PATH: toolPath }) === null
    ? toolPath
    : null;
};

const run = async (
  command: readonly string[],
  cwd: string,
  searchPath: string,
  expectedExitCode = 0,
  extra: Readonly<Record<string, string>> = {}
): Promise<{ readonly exitCode: number; readonly stdout: string }> => {
  const child = Bun.spawn([...command], {
    cwd,
    env: { HOME: dir, PATH: searchPath, ...extra },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== expectedExitCode) {
    throw new Error(
      `${command.join(" ")} exited ${exitCode}, expected ${expectedExitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  }
  return { exitCode, stdout };
};

const repo = async (name: string): Promise<string> => {
  const root = path.join(dir, name);
  await mkdir(path.join(root, ".git"), { recursive: true });
  await Bun.write(path.join(root, "README.md"), README);
  return root;
};

test("the binary says it is one", async () => {
  const { stdout } = await run([binary, "--version"], dir, "");
  expect(stdout).toBe(`${manifest.version} (binary)\n`);
});

test.skipIf(process.platform !== "darwin")(
  "the binary recovers a Taplo sandbox panic with no Bun on PATH",
  async () => {
    await qualifyStandaloneTaplo(binary, await repo("taplo-recovery"));
  }
);

test("mise installs the checked artifact and runs it with no Bun on PATH", async () => {
  await qualifyMiseInstall({
    binary,
    engines: toolPath,
    root: await repo("mise-install"),
  });
}, 30_000);

test("an unexpected subprocess failure reports its command, exit and stderr", async () => {
  const failure = await run([binary, "nope"], dir, "").catch(
    (error: unknown) => error
  );
  expect(failure).toBeInstanceOf(Error);
  if (failure instanceof Error) {
    expect(failure.message).toMatch(
      /cinch nope exited 2, expected 0[\s\S]*stderr:[\s\S]*unknown command/u
    );
  }
});

test("the binary carries the presets, and writes them with no Bun in reach", async () => {
  const root = await repo("kept");
  // With no engine in reach the run is incomplete. The files are still kept.
  await run([binary, "init", "--yes"], root, "", 2);
  const kept = await Bun.file(path.join(root, KEPT)).text();
  expect(kept.endsWith(await Bun.file(SHIPPED).text())).toBe(true);
});

test("the binary finds what the package finds", async () => {
  const searchPath = withoutBun();
  if (searchPath === null) {
    console.warn("skipped: needs rumdl, taplo and git on PATH");
    return;
  }
  const root = await repo("same");
  await run([binary, "init", "--yes"], root, searchPath);
  const alone = await run([binary, "check"], root, searchPath, 1);
  const packaged = await run(
    [process.execPath, CLI, "check"],
    root,
    process.env.PATH ?? "",
    1
  );
  expect(alone.stdout).toContain("MD025");
  expect(alone.exitCode).toBe(1);
  expect(alone).toEqual(packaged);
});

test("the binary formats fenced code with no Bun in reach", async () => {
  const searchPath = withoutBun();
  if (searchPath === null) {
    console.warn("skipped: needs rumdl, taplo and git on PATH");
    return;
  }
  const root = await repo("fences");
  await Bun.write(path.join(root, "README.md"), FENCES);
  await run([binary, "init", "--yes"], root, searchPath);
  const alone = await run([binary, "check"], root, searchPath, 1);
  const packaged = await run(
    [process.execPath, CLI, "check"],
    root,
    process.env.PATH ?? "",
    1
  );
  expect(alone.exitCode).toBe(1);
  expect(alone).toEqual(packaged);
  const fixed = await run([binary, "fix"], root, searchPath);
  expect(fixed.exitCode).toBe(0);
  expect(await Bun.file(path.join(root, "README.md")).text()).toBe(FORMATTED);
  const files = await Array.fromAsync(
    new Bun.Glob("**/bun").scan({ cwd: root, dot: true })
  );
  expect(files).toEqual([]);
});

test("read-only standalone checks keep the Bun helper outside the checkout", async () => {
  const searchPath = withoutBun();
  if (searchPath === null) {
    console.warn("skipped: needs rumdl, taplo and git on PATH");
    return;
  }
  await qualifyStandaloneCache({
    binary,
    contents: FORMATTED,
    root: await repo("cache-fixture"),
    run: (command, cwd, expected, env) =>
      run(command, cwd, searchPath, expected, env),
  });
});

test("the binary carries the rules Cinch ships", async () => {
  if (Bun.which("ast-grep", { PATH: toolPath }) === null) {
    console.warn("skipped: needs ast-grep on PATH");
    return;
  }
  const root = await repo("rules");
  await Bun.write(
    path.join(root, "cinch.toml"),
    'pilot = 0\ninclude = ["**/*.json"]\n\n[rules]\nenabled = true\npacks = ["config"]\n'
  );
  await Bun.write(path.join(root, "tsconfig.json"), "{}\n");
  const alone = await run(
    [binary, "check", "tsconfig.json"],
    root,
    toolPath,
    1
  );
  expect(alone.stdout).toContain("config/tsconfig-extends");
  expect(alone.exitCode).toBe(1);
});
