import { expect } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nativeCommand } from "../../cinch/src/adapters/taplo/wasm.ts";
import { fixtureGit, runEntry } from "../../cinch/tests/acceptance-repo.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);
const BUILD = new URL("../scripts/build-binary.ts", import.meta.url);

/** Build or select the public binary with only external engines on its PATH. */
export const standaloneFixture = async () => {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-binary-"))
  );
  const engines = path.join(directory, "engines");
  const gitOnly = path.join(directory, "git-only");
  await mkdir(engines);
  await mkdir(gitOnly);
  await Promise.all(
    ["git", "rumdl", "taplo", "ast-grep"].map(async (tool) => {
      const executable =
        tool === "taplo" ? await nativeCommand(tool) : Bun.which(tool);
      if (executable === null) {
        if (process.env.CI === "true") {
          throw new Error(
            `The standalone Ropes proof requires ${tool} on PATH.`
          );
        }
        return;
      }
      await symlink(await realpath(executable), path.join(engines, tool));
      if (tool === "git") {
        await symlink(await realpath(executable), path.join(gitOnly, tool));
      }
    })
  );
  const binary = process.env.ROPES_BINARY ?? path.join(directory, "rope");
  if (!path.isAbsolute(binary)) {
    throw new Error("ROPES_BINARY must be an absolute path to the candidate.");
  }
  if (process.env.ROPES_BINARY === undefined) {
    const child = Bun.spawn([process.execPath, fileURLToPath(BUILD), binary], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Standalone rope build failed: ${stderr}`);
    }
  }
  const command = async (
    args: readonly string[],
    cwd: string,
    searchPath = engines,
    extra: Readonly<Record<string, string>> = {}
  ) => {
    const child = Bun.spawn([...args], {
      cwd,
      env: {
        HOME: directory,
        PATH: searchPath,
        XDG_CACHE_HOME: path.join(directory, "cache"),
        ...extra,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stderr, stdout };
  };
  const run = (args: readonly string[], cwd: string, searchPath = engines) =>
    command([binary, ...args], cwd, searchPath);
  const fixture = async (
    name: string,
    text = "# Guide\n\n# Another title\n"
  ) => {
    const root = path.join(directory, name);
    await mkdir(root);
    await Bun.write(
      path.join(root, "rope.toml"),
      "pilot = 0\n[toml]\nenabled = false\n"
    );
    await Bun.write(path.join(root, "README.md"), text);
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    const initialized = await runEntry(
      CLI,
      ["doctor", "--fix", "--json"],
      root
    );
    expect(initialized.exitCode).toBe(0);
    await fixtureGit(root, "add", ".");
    await fixtureGit(
      root,
      "commit",
      "--quiet",
      "--allow-empty",
      "--message",
      "setup"
    );
    return root;
  };
  const needsEngine = () => {
    if (Bun.which("rumdl", { PATH: engines }) !== null) {
      return false;
    }
    console.warn("skipped: rumdl is required for the standalone Ropes proof");
    return true;
  };
  return {
    binary,
    command,
    directory,
    engines,
    fixture,
    gitOnly,
    needsEngine,
    run,
  };
};
