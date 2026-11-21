import assert from "node:assert/strict";
import { cp, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import cli from "../package.json" with { type: "json" };
import { run } from "./packed-run.ts";

/** Reject both committed and staged code under any installed dependency. */
export const proveInstallTrust = async (
  folder: string,
  cwd: string,
  executable: string,
  selected: string
): Promise<void> => {
  const marker = path.join(folder, "untrusted-code-executed");
  const git = (...args: string[]) =>
    run(
      [
        "git",
        "-c",
        "user.name=Ropes",
        "-c",
        "user.email=ropes@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      cwd
    );
  const invoke = async (
    message = /Refusing checkout-owned installed code/u
  ) => {
    const child = Bun.spawn([process.execPath, executable, "--version"], {
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    });
    assert.equal(await child.exited, 2);
    assert.match(await new Response(child.stderr).text(), message);
    assert.equal(await Bun.file(marker).exists(), false);
  };
  const original = await Bun.file(selected).text();
  const forged = path.relative(cwd, path.dirname(path.dirname(selected)));
  await Bun.write(
    selected,
    `await Bun.write(${JSON.stringify(marker)}, "executed"); process.exit(0);\n`
  );
  await git("add", "--force", forged);
  await invoke();
  await git("commit", "--quiet", "--message", "tracked runtime regression");
  await invoke();
  await git("rm", "--cached", "-r", "--quiet", forged);
  await invoke();
  await git("commit", "--quiet", "--message", "remove tracked runtime fixture");
  await Bun.write(selected, original);
  const trackedCaseAlias = "Node_Modules/ropes-case-proof.txt";
  const resolved = await git("rev-parse", "HEAD:README.md");
  const blob = resolved.trim();
  await git(
    "update-index",
    "--add",
    "--cacheinfo",
    `100644,${blob},${trackedCaseAlias}`
  );
  await invoke();
  await git("update-index", "--force-remove", "--", trackedCaseAlias);
  const core = await realpath(
    path.join(cwd, "node_modules/@ropes/core/src/index.ts")
  );
  const coreOriginal = await Bun.file(core).text();
  await Bun.write(
    core,
    `await Bun.write(${JSON.stringify(marker)}, "executed"); throw new Error("Untrusted core");\n`
  );
  await git("add", "--force", path.relative(cwd, core));
  await invoke();
  await git("rm", "--cached", "--quiet", path.relative(cwd, core));
  await Bun.write(core, coreOriginal);
  const cliRoot = path.dirname(path.dirname(selected));
  await run(["git", "init", "--quiet", "--template="], cliRoot);
  await Bun.write(
    selected,
    `await Bun.write(${JSON.stringify(marker)}, "executed"); process.exit(0);\n`
  );
  await invoke(/must belong to the current checkout/u);
  await rm(path.join(cliRoot, ".git"), { recursive: true });
  await Bun.write(selected, original);
  const coreRoot = path.dirname(path.dirname(core));
  await run(["git", "init", "--quiet", "--template="], coreRoot);
  await Bun.write(
    core,
    `await Bun.write(${JSON.stringify(marker)}, "executed"); throw new Error("Nested core");\n`
  );
  await invoke(/must belong to the current checkout/u);
  await rm(path.join(coreRoot, ".git"), { recursive: true });
  await Bun.write(core, coreOriginal);
  await mkdir(path.join(cwd, ".jj"));
  await run([process.execPath, executable, "--version"], cwd);
  await rm(path.join(cwd, ".jj"), { recursive: true });
  const native = path.join(folder, "native-jj");
  await mkdir(path.join(native, ".jj"), { recursive: true });
  await Bun.write(
    path.join(native, "package.json"),
    JSON.stringify({ devDependencies: { "@ropes/cli": cli.version } })
  );
  await cp(path.join(cwd, "node_modules"), path.join(native, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await run([process.execPath, executable, "--version"], native, {
    exitCode: 2,
  });
};
