import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import cli from "../package.json" with { type: "json" };
import { run } from "./packed-run.ts";

/** Help is available before setup and follows the selected CLI after setup. */
export const proveLauncherHelp = async (
  folder: string,
  consumer: string,
  executable: string
): Promise<void> => {
  const unconfigured = path.join(folder, "unconfigured");
  await mkdir(unconfigured);
  await run(["git", "init", "--quiet", "--template="], unconfigured);
  await Bun.write(path.join(unconfigured, "package.json"), '{"private":true}');
  await run(["git", "add", "package.json"], unconfigured);
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
      "unconfigured launcher fixture",
    ],
    unconfigured
  );
  for (const option of ["--help", "-h"]) {
    // eslint-disable-next-line no-await-in-loop -- each entry is checked independently
    const help = await run(
      [process.execPath, executable, option],
      unconfigured
    );
    assert.match(help, /^rope 99\.0\.0\n/u);
    assert.match(help, /Usage: rope <explain\|check\|fix>/u);
    assert.match(help, /bun add --dev --exact @ropes\/cli@99\.0\.0/u);
    assert.match(help, /\.\/node_modules\/\.bin\/rope explain README\.md/u);
  }
  const selected = await run(
    [process.execPath, executable, "--help"],
    consumer
  );
  assert.ok(selected.startsWith(`rope ${cli.version}\n`));
  assert.equal(
    selected,
    await run(
      [path.join(consumer, "node_modules/.bin/rope"), "--help"],
      consumer
    )
  );
  for (const option of ["check", "--version"]) {
    const child = Bun.spawn([process.execPath, executable, option], {
      cwd: unconfigured,
      stderr: "pipe",
      stdout: "pipe",
    });
    // eslint-disable-next-line no-await-in-loop -- verify both setup failures separately
    const [stderr, code] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert.equal(code, 2);
    assert.match(stderr, /Pin @ropes\/cli to an exact version/u);
  }
};
