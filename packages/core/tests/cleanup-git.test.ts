import { expect, test } from "bun:test";
import path from "node:path";

import { gitText, treeEntries } from "../src/commands/cleanup/git.ts";
import { fixtureGit, withFixture } from "./acceptance-repo.ts";

test("immutable cleanup reads reject unsupported path encodings and aliases", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(
      path.join(main.root, "back\\slash.txt"),
      "ambiguous path\n"
    );
    await fixtureGit(main.root, "add", "--all");
    await fixtureGit(
      main.root,
      "commit",
      "--quiet",
      "--message",
      "backslash path"
    );
    const refusal = await treeEntries(main.root, "HEAD").catch(String);
    expect(refusal).toContain("Unsupported snapshot entry");
    await fixtureGit(main.root, "rm", "back\\slash.txt");
    const blob = await gitText(main.root, "rev-parse", "HEAD:README.md");
    const child = Bun.spawn(["git", "-C", main.root, "mktree", "-z"], {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
      ),
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    await child.stdin.write(
      Buffer.concat([
        Buffer.from(`100644 blob ${blob.trim()}\t`),
        Buffer.from([255, 0]),
      ])
    );
    await child.stdin.end();
    const tree = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const rejected = await treeEntries(main.root, tree.trim()).catch(
      (error: unknown) => error
    );
    expect(rejected).toBeInstanceOf(Error);
  });
});
