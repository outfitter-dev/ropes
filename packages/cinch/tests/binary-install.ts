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
  const missing = ["rumdl", "taplo", "git"].filter(
    (tool) => Bun.which(tool, { PATH: engines }) === null
  );
  if (missing.length > 0) {
    if (Bun.env.CI === "true") {
      throw new Error(
        `The standalone CI installation proof requires ${missing.join(", ")}.`
      );
    }
    console.warn(
      `skipped: standalone installation needs ${missing.join(", ")} on PATH`
    );
    return;
  }
  const state = path.join(path.dirname(root), "mise-install-state");
  const config = path.join(root, "mise.toml");
  const digest = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(binary).bytes())
    .digest("hex");
  const env = {
    HOME: path.join(state, "home"),
    MISE_CACHE_DIR: path.join(state, "cache"),
    MISE_CEILING_PATHS: path.dirname(root),
    MISE_CONFIG_DIR: path.join(state, "config"),
    MISE_DATA_DIR: path.join(state, "data"),
    MISE_STATE_DIR: path.join(state, "state"),
    MISE_SYSTEM_CONFIG_DIR: path.join(state, "system"),
    MISE_TRUSTED_CONFIG_PATHS: path.dirname(root),
    MISE_YES: "1",
    PATH: engines,
    XDG_CACHE_HOME: path.join(state, "cache"),
    XDG_CONFIG_HOME: path.join(state, "config"),
    XDG_STATE_HOME: path.join(state, "state"),
  };
  expect(Bun.which("bun", { PATH: env.PATH })).toBeNull();
  const run = async (
    args: readonly string[],
    overrides: Readonly<Record<string, string>> = {}
  ) => {
    const child = Bun.spawn([mise, ...args], {
      cwd: root,
      env: { ...env, ...overrides },
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
  const pin = (checksum: string, version = manifest.version) =>
    Bun.write(
      config,
      [
        '[tools."http:cinch"]',
        `version = ${JSON.stringify(version)}`,
        `url = ${JSON.stringify(pathToFileURL(binary).href)}`,
        'bin = "cinch"',
        `checksum = "sha256:${checksum}"`,
        "",
      ].join("\n")
    );

  await mkdir(root, { recursive: true });
  await mkdir(state, { recursive: true });
  await mkdir(env.MISE_SYSTEM_CONFIG_DIR, { recursive: true });
  const unrelatedSystem = path.join(state, "unrelated-system");
  // Show the unrelated system config is discovered only when directed there.
  await Bun.write(
    path.join(unrelatedSystem, "config.toml"),
    '[tools."http:unexpected-system-tool"]\nversion = "1.0.0"\nurl = "file:///missing-system-tool"\n'
  );
  await pin(digest);
  const leaked = await run(["install"], {
    MISE_SYSTEM_CONFIG_DIR: unrelatedSystem,
  });
  expect(leaked.exitCode).not.toBe(0);
  expect(leaked.stderr).toContain(path.join(unrelatedSystem, "config.toml"));
  await pin("0".repeat(64));
  const configured = await run(["config", "ls", "--no-header"]);
  expect(configured.exitCode).toBe(0);
  expect(configured.stdout.trim()).toStartWith(config);
  expect(configured.stdout.trim().split("\n")).toHaveLength(1);
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

  await pin("0".repeat(64));
  // mise identifies an installed tool by backend and version. Ordinary install
  // reuses it even if the config's URL/checksum changed under the same version.
  const cached = await run(["install", "http:cinch"]);
  expect(cached.exitCode).toBe(0);
  const cachedVersion = await run(["exec", "--", "cinch", "--version"]);
  expect(cachedVersion.exitCode).toBe(0);
  expect(cachedVersion.stdout).toBe(`${manifest.version} (binary)\n`);
  const forced = await run(["install", "--force", "http:cinch"]);
  expect(forced.exitCode).not.toBe(0);
  expect(forced.stderr).toMatch(/checksum|sha256/iu);

  // A new cache identity must verify its bytes. This synthetic mise label
  // exercises the installer without creating another release of the binary.
  const repinnedVersion = `${manifest.version}-install-proof`;
  await pin("0".repeat(64), repinnedVersion);
  const repinRejected = await run(["install", "http:cinch"]);
  expect(repinRejected.exitCode).not.toBe(0);
  expect(repinRejected.stderr).toMatch(/checksum|sha256/iu);
  await pin(digest, repinnedVersion);
  const repinned = await run(["install", "http:cinch"]);
  expect(repinned.exitCode).toBe(0);
  const location = await run(["where", "http:cinch"]);
  expect(location.exitCode).toBe(0);
  expect(location.stdout).toContain(repinnedVersion);
  const selectedDigest = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path.join(location.stdout.trim(), "cinch")).bytes())
    .digest("hex");
  expect(selectedDigest).toBe(digest);

  await pin(digest);
  const restored = await run(["install", "--force", "http:cinch"]);
  expect(restored.exitCode).toBe(0);
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
