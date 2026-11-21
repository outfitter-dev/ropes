import { expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import manifest from "../package.json" with { type: "json" };

/** Install a real host binary through mise, with every cache kept in the fixture. */
export const qualifyMiseInstall = async (input: {
  readonly binary: string;
  readonly engines: string;
  readonly root: string;
}): Promise<void> => {
  const mise = Bun.which("mise");
  if (mise === null) {
    if (Bun.env.CI === "true") {
      throw new Error("The standalone CI proof requires mise on PATH.");
    }
    console.warn("skipped: standalone installation needs mise on PATH");
    return;
  }
  const { binary, engines, root } = input;
  const state = path.join(path.dirname(root), "mise-install-state");
  const config = path.join(root, "mise.toml");
  const digest = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(binary).bytes())
    .digest("hex");
  const env = {
    HOME: path.join(state, "home"),
    MISE_CACHE_DIR: path.join(state, "cache"),
    MISE_CONFIG_DIR: path.join(state, "config"),
    MISE_DATA_DIR: path.join(state, "data"),
    MISE_TRUSTED_CONFIG_PATHS: root,
    MISE_YES: "1",
    PATH: engines,
    XDG_CACHE_HOME: path.join(state, "cache"),
  };
  expect(Bun.which("bun", { PATH: env.PATH })).toBeNull();
  const run = async (args: readonly string[]) => {
    const child = Bun.spawn([mise, ...args], {
      cwd: root,
      env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stderr, stdout };
  };
  const pin = (checksum: string) =>
    Bun.write(
      config,
      [
        '[tools."http:cinch"]',
        `version = ${JSON.stringify(manifest.version)}`,
        `url = ${JSON.stringify(pathToFileURL(binary).href)}`,
        'bin = "cinch"',
        `checksum = "sha256:${checksum}"`,
        "",
      ].join("\n")
    );

  await mkdir(root, { recursive: true });
  await pin("0".repeat(64));
  const rejected = await run(["install"]);
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.stderr).toMatch(/checksum|sha256/iu);
  const unavailable = await run(["where", "http:cinch"]);
  expect(unavailable.exitCode).not.toBe(0);

  await pin(digest);
  const installed = await run(["install"]);
  if (installed.exitCode !== 0) {
    throw new Error(`mise install failed: ${installed.stderr}`);
  }
  const keptConfig = await Bun.file(config).text();
  const version = await run(["exec", "--", "cinch", "--version"]);
  expect(version.exitCode).toBe(0);
  expect(version.stdout).toBe(`${manifest.version} (binary)\n`);
  const again = await run(["install"]);
  expect(again.exitCode).toBe(0);
  expect(await Bun.file(config).text()).toBe(keptConfig);

  const setup = await run(["exec", "--", "cinch", "init", "--yes"]);
  expect(setup.exitCode).toBe(0);
  const direct = Bun.spawn([binary, "check", "README.md", "--json"], {
    cwd: root,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [directExit, directOutput] = await Promise.all([
    direct.exited,
    new Response(direct.stdout).text(),
  ]);
  const selected = await run([
    "exec",
    "--",
    "cinch",
    "check",
    "README.md",
    "--json",
  ]);
  expect(directExit).toBe(1);
  expect(directOutput).toContain("MD025");
  expect(selected.exitCode).toBe(directExit);
  expect(selected.stdout).toBe(directOutput);
};
