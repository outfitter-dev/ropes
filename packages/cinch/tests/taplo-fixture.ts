import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fixtureGit } from "./acceptance-repo.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);

export const inRepo = async (
  body: (root: string, bin: string) => Promise<void>
): Promise<void> => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "taplo-report-"))
  );
  const bin = path.join(root, "bin");
  try {
    await mkdir(bin);
    await Bun.write(path.join(root, "a.toml"), "a = 1\n");
    await Bun.write(path.join(root, "cinch.toml"), "pilot = 0\n");
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", "a.toml", "cinch.toml");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    await body(root, bin);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

export const fakeTaplo = async (bin: string, stderr: string, code: number) => {
  const command = path.join(bin, "taplo");
  await Bun.write(`${command}.stderr`, stderr);
  await Bun.write(
    command,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "taplo 0.10.0"; exit 0; fi',
      'printf "%s" "$RUST_LOG" > "$0.filter"',
      '/bin/cat "$0.stderr" >&2',
      `exit ${code}`,
      "",
    ].join("\n")
  );
  await chmod(command, 0o755);
  return command;
};

export const check = async (
  root: string,
  searchPath: string,
  json = true,
  cli = CLI
) => {
  const child = Bun.spawn(
    [
      process.execPath,
      cli.pathname,
      "check",
      "a.toml",
      ...(json ? ["--json"] : []),
    ],
    {
      cwd: root,
      env: { ...Bun.env, PATH: searchPath, RUST_LOG: "error" },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
};
