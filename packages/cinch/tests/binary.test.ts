import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import manifest from "../package.json" with { type: "json" };

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

beforeAll(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-bin-")));
  binary = path.join(dir, "cinch");
  const built = Bun.spawn(["bun", BUILD, binary], {
    stderr: "pipe",
    stdout: "ignore",
  });
  if ((await built.exited) !== 0) {
    throw new Error(await new Response(built.stderr).text());
  }
});

afterAll(() => rm(dir, { force: true, recursive: true }));

/** A search path with the engines and Git on it, and no Bun. */
const withoutBun = (): string | null => {
  const tools = ["rumdl", "taplo", "git"].map((name) => Bun.which(name));
  const found = tools.flatMap((tool) =>
    tool === null ? [] : [path.dirname(tool)]
  );
  const searchPath = found.join(path.delimiter);
  return found.length === tools.length &&
    Bun.which("bun", { PATH: searchPath }) === null
    ? searchPath
    : null;
};

const run = async (
  command: readonly string[],
  cwd: string,
  searchPath: string,
  extra: Readonly<Record<string, string>> = {}
): Promise<{ readonly exitCode: number; readonly stdout: string }> => {
  const child = Bun.spawn([...command], {
    cwd,
    env: { HOME: dir, PATH: searchPath, ...extra },
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  return { exitCode: await child.exited, stdout };
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

test("the binary carries the presets, and writes them with no Bun in reach", async () => {
  const root = await repo("kept");
  // With no engine in reach the run is incomplete. The files are still kept.
  await run([binary, "init", "--yes"], root, "");
  const kept = await Bun.file(path.join(root, KEPT)).text();
  expect(kept.endsWith(await Bun.file(SHIPPED).text())).toBe(true);
});

test("the binary finds what the package finds", async () => {
  const searchPath = withoutBun();
  if (searchPath === null) {
    console.warn(
      "skipped: needs rumdl, taplo and git on PATH, in folders that hold no bun"
    );
    return;
  }
  const root = await repo("same");
  await run([binary, "init", "--yes"], root, searchPath);
  const alone = await run([binary, "check"], root, searchPath);
  const packaged = await run(
    [process.execPath, CLI, "check"],
    root,
    process.env.PATH ?? ""
  );
  expect(alone.stdout).toContain("MD025");
  expect(alone.exitCode).toBe(1);
  expect(alone).toEqual(packaged);
});

test("the binary formats fenced code with no Bun in reach", async () => {
  const searchPath = withoutBun();
  if (searchPath === null) {
    console.warn(
      "skipped: needs rumdl, taplo and git on PATH, in folders that hold no bun"
    );
    return;
  }
  const root = await repo("fences");
  await Bun.write(path.join(root, "README.md"), FENCES);
  await run([binary, "init", "--yes"], root, searchPath);
  const alone = await run([binary, "check"], root, searchPath);
  const packaged = await run(
    [process.execPath, CLI, "check"],
    root,
    process.env.PATH ?? ""
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

test("an empty cache override does not put the stand-in in the repository", async () => {
  const searchPath = withoutBun();
  if (searchPath === null) {
    console.warn(
      "skipped: needs rumdl, taplo and git on PATH, in folders that hold no bun"
    );
    return;
  }
  const root = await repo("override");
  await Bun.write(path.join(root, "README.md"), FORMATTED);
  await mkdir(path.join(root, "docs"));
  await run([binary, "init", "--yes"], root, searchPath);
  const below = await run(
    [binary, "check"],
    path.join(root, "docs"),
    searchPath,
    {
      XDG_CACHE_HOME: "",
    }
  );
  expect(below.exitCode).toBe(0);
  const files = await Array.fromAsync(
    new Bun.Glob("**/bun").scan({ cwd: root, dot: true })
  );
  expect(files).toEqual([]);
});

test("a relative home does not put the stand-in in the repository", async () => {
  const searchPath = withoutBun();
  if (searchPath === null) {
    console.warn(
      "skipped: needs rumdl, taplo and git on PATH, in folders that hold no bun"
    );
    return;
  }
  const root = await repo("home");
  await Bun.write(path.join(root, "README.md"), FORMATTED);
  await mkdir(path.join(root, "docs"));
  await run([binary, "init", "--yes"], root, searchPath);
  const below = await run(
    [binary, "check"],
    path.join(root, "docs"),
    searchPath,
    { HOME: "relative" }
  );
  expect(below.exitCode).toBe(2);
  const created = await Array.fromAsync(
    new Bun.Glob("**/bun").scan({ cwd: root, dot: true })
  );
  expect(created).toEqual([]);
});

test("the binary carries the rules Cinch ships", async () => {
  const engine = Bun.which("ast-grep");
  const searchPath = engine === null ? null : path.dirname(engine);
  if (searchPath === null || Bun.which("bun", { PATH: searchPath }) !== null) {
    console.warn(
      "skipped: needs ast-grep on PATH, in a folder that holds no bun"
    );
    return;
  }
  const root = await repo("rules");
  await Bun.write(
    path.join(root, "cinch.toml"),
    'pilot = 0\ninclude = ["**/*.json"]\n\n[rules]\nenabled = true\npacks = ["config"]\n'
  );
  await Bun.write(path.join(root, "tsconfig.json"), "{}\n");
  const alone = await run([binary, "check", "tsconfig.json"], root, searchPath);
  expect(alone.stdout).toContain("config/tsconfig-extends");
  expect(alone.exitCode).toBe(1);
});
