import { realpath } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";

const git = async (root: string, args: readonly string[]) => {
  const child = Bun.spawn(
    [
      "git",
      "--literal-pathspecs",
      "-c",
      "core.fsmonitor=false",
      "-C",
      root,
      ...args,
    ],
    {
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => !name.startsWith("GIT_")
          )
        ),
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
      },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Cannot verify installed dependency tracking. Use a Git or colocated jj checkout with readable HEAD and index. ${stderr.trim()}`
    );
  }
  return stdout;
};

/** A package install is the trust boundary. Checkout-owned code cannot stand in for it. */
export const verifyInstalledFiles = async (
  root: string,
  installed: readonly string[]
): Promise<void> => {
  if (
    installed.some((file) => {
      const relative = path.relative(root, file);
      return (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        !relative.split(path.sep).includes("node_modules")
      );
    })
  ) {
    throw new Error(
      "Install the pinned @ropes/cli package under this checkout's node_modules before running rope."
    );
  }
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  if ((await realpath(top.trim())) !== root) {
    throw new Error(
      "Cannot verify installed dependency tracking for this checkout. Use a Git or colocated jj checkout."
    );
  }
  const listed = await Promise.all([
    git(root, ["ls-files", "--cached", "-z"]),
    git(root, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]),
  ]);
  const tracked = listed
    .flatMap((listing) => listing.split("\0"))
    .find((file) => file.split("/").includes("node_modules"));
  if (tracked !== undefined) {
    throw new Error(
      `Refusing checkout-owned installed code at ${tracked}. Remove tracked node_modules files and reinstall the pinned dependencies before running rope.`
    );
  }
};
