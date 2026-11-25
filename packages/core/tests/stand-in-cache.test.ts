import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("standalone helpers use the Ropes cache directory and preserve retired cache bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-cache-name-"));
  try {
    const source = path.join(root, "probe.ts");
    const module = fileURLToPath(
      new URL("../src/adapters/stand-in.ts", import.meta.url)
    );
    await Bun.write(
      source,
      `import { configureStandIn, enginePath } from ${JSON.stringify(module)};\nconfigureStandIn(async () => true);\nconsole.log(await enginePath());\n`
    );
    const outdir = path.join(root, "built");
    const built = await Bun.build({
      define: { ROPES_SHIPPED: "{}" },
      entrypoints: [source],
      outdir,
      target: "bun",
    });
    expect(built.success).toBe(true);
    const cache = path.join(root, "cache");
    const retired = path.join(cache, "cinch/stand-in/old/bun");
    await Bun.write(retired, "retained old cache bytes\n");
    const child = Bun.spawn([process.execPath, path.join(outdir, "probe.js")], {
      env: {
        HOME: path.join(root, "home"),
        PATH: "/usr/bin",
        XDG_CACHE_HOME: cache,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const helper = stdout.trim().split(path.delimiter).at(-1);
    expect(helper).toContain(path.join(cache, "ropes/stand-in"));
    if (helper === undefined) {
      throw new Error("Expected an installed helper folder");
    }
    const installed = path.join(helper, "bun");
    expect(await readFile(installed, "utf-8")).toContain("BUN_BE_BUN=1");
    const installedStats = await stat(installed);
    const installedMode = installedStats.mode;
    // eslint-disable-next-line no-bitwise -- verify executable helper permissions
    expect(installedMode & 0o777).toBe(0o755);
    expect(await readFile(retired, "utf-8")).toBe("retained old cache bytes\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
