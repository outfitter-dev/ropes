import assert from "node:assert/strict";
import { cp, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import cli from "../package.json" with { type: "json" };
import { proveCancellation } from "./packed-launcher-cancel.ts";
import { proveLauncherHelp } from "./packed-launcher-help.ts";
import { proveInstallTrust } from "./packed-launcher-trust.ts";
import { run } from "./packed-run.ts";

const manifest = (version: string) =>
  JSON.stringify({
    devDependencies: { "@ropes/cli": version },
    private: true,
  });

/** Exercises the launcher from a second packed installation, outside its target. */
export const proveDelegation = async (
  folder: string,
  consumer: string
): Promise<void> => {
  const global = path.join(folder, "global");
  await mkdir(global);
  await cp(
    path.join(consumer, "node_modules"),
    path.join(global, "node_modules"),
    { recursive: true, verbatimSymlinks: true }
  );
  const globalManifest = path.join(
    global,
    "node_modules/@ropes/cli/package.json"
  );
  await Bun.write(
    globalManifest,
    JSON.stringify({
      ...cli,
      dependencies: { "@ropes/core": cli.version },
      version: "99.0.0",
    })
  );
  const executable = path.join(global, "node_modules/@ropes/cli/src/cli.ts");
  const invoke = (
    cwd: string,
    args: readonly string[],
    options: { exitCode?: number } = {}
  ) => run([process.execPath, executable, ...args], cwd, options);
  await proveLauncherHelp(folder, consumer, executable);
  const localEntry = await realpath(
    path.join(consumer, "node_modules/.bin/rope")
  );
  const expected = `rope ${cli.version}\n${localEntry}`;
  const nested = path.join(consumer, "packages/app/src");
  await mkdir(nested, { recursive: true });
  await Bun.write(
    path.join(consumer, "packages/app/package.json"),
    '{"private":true}'
  );
  for (const cwd of [consumer, nested]) {
    // eslint-disable-next-line no-await-in-loop -- exercise each entry directory separately
    const version = await invoke(cwd, ["--version"]);
    assert.equal(version.trim(), expected);
  }
  const selected = await invoke(consumer, ["explain", "README.md", "--json"]);
  assert.equal(
    selected,
    await run([localEntry, "explain", "README.md", "--json"], consumer)
  );
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
      consumer
    );
  await git("add", "package.json", "README.md", "rope.toml");
  await git("commit", "--quiet", "--message", "launcher fixture");
  const linked = path.join(folder, "linked");
  await git("worktree", "add", "--quiet", "-b", "launcher-proof", linked);
  await cp(
    path.join(consumer, "node_modules"),
    path.join(linked, "node_modules"),
    { recursive: true, verbatimSymlinks: true }
  );
  const linkedEntry = await realpath(
    path.join(linked, "node_modules/.bin/rope")
  );
  const linkedVersion = await invoke(linked, ["--version"]);
  assert.equal(linkedVersion.trim(), `rope ${cli.version}\n${linkedEntry}`);
  const nestedPackage = path.join(consumer, "packages/app");
  const nestedInstall = path.join(nestedPackage, "node_modules/@ropes/cli");
  await mkdir(path.dirname(nestedInstall), { recursive: true });
  await cp(path.dirname(path.dirname(localEntry)), nestedInstall, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await Bun.write(
    path.join(nestedInstall, "package.json"),
    JSON.stringify({
      ...cli,
      dependencies: { "@ropes/core": cli.version },
      version: "0.0.1",
    })
  );
  await Bun.write(path.join(nestedPackage, "package.json"), manifest("0.0.1"));
  const nestedVersion = await invoke(nested, ["--version"]);
  assert.equal(
    nestedVersion.trim(),
    `rope 0.0.1\n${await realpath(path.join(nestedInstall, "src/cli.ts"))}`
  );
  await Bun.write(path.join(nestedPackage, "package.json"), '{"private":true}');
  await rm(path.join(nestedPackage, "node_modules"), { recursive: true });
  await proveCancellation(folder, consumer, executable, localEntry);
  await proveInstallTrust(folder, consumer, executable, localEntry);
  await Bun.write(path.join(consumer, "package.json"), manifest("^0.0.0"));
  await invoke(nested, ["check", "--json"], { exitCode: 2 });
  await Bun.write(path.join(consumer, "package.json"), manifest("1.2.3"));
  await invoke(consumer, ["check", "--json"], { exitCode: 2 });
  await Bun.write(path.join(consumer, "package.json"), manifest(cli.version));
  const localManifest = path.join(
    consumer,
    "node_modules/@ropes/cli/package.json"
  );
  const installedManifest = await Bun.file(localManifest).text();
  await Bun.write(localManifest, JSON.stringify({ ...cli, ropesLauncher: 99 }));
  await invoke(consumer, ["check", "--json"], { exitCode: 2 });
  await Bun.write(localManifest, installedManifest);
  const entryText = await Bun.file(localEntry).text();
  await rm(localEntry);
  const missing = Bun.spawn([process.execPath, executable, "check"], {
    cwd: consumer,
    stderr: "pipe",
    stdout: "pipe",
  });
  assert.equal(await missing.exited, 2);
  assert.match(
    await new Response(missing.stderr).text(),
    /Reinstall @ropes\/cli/u
  );
  await Bun.write(localEntry, entryText);
  const recursive = Bun.spawn([process.execPath, executable, "check"], {
    cwd: consumer,
    env: { ...process.env, ROPES_DELEGATED_ENTRY: executable },
    stderr: "pipe",
    stdout: "pipe",
  });
  assert.equal(await recursive.exited, 2);
  assert.match(
    await new Response(recursive.stderr).text(),
    /Recursive rope delegation/u
  );
  await rm(path.join(consumer, "node_modules/@ropes/cli"), { recursive: true });
  await invoke(consumer, ["check", "--json"], { exitCode: 2 });
  await Bun.write(
    path.join(consumer, "package.json"),
    '{"devDependencies":{"outfitter":"0.0.0"}}'
  );
  await invoke(consumer, ["check", "--json"], { exitCode: 2 });
  console.log(
    "Global rope selected the exact local install from root, nested package and linked worktree, and rejected unusable pins and recursion."
  );
};
