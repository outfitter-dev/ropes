import { expect } from "bun:test";
import { link, mkdir, readdir, stat, symlink } from "node:fs/promises";
import path from "node:path";

import { fixtureGit } from "./acceptance-repo.ts";

type Run = (
  command: readonly string[],
  cwd: string,
  expected?: number,
  env?: Readonly<Record<string, string>>
) => Promise<{ readonly stdout: string }>;

const helpers = (cache: string): Promise<string[]> =>
  Array.fromAsync(
    new Bun.Glob("ropes/stand-in/*/bun").scan({ cwd: cache, dot: true })
  );

/** Exercise the real binary below the checkout root with no Bun on PATH. */
export const qualifyStandaloneCache = async (input: {
  readonly binary: string;
  readonly contents: string;
  readonly root: string;
  readonly run: Run;
}): Promise<void> => {
  const { binary, contents, root, run } = input;
  const state = path.join(path.dirname(root), "cache-fixture-state");
  const docs = path.join(root, "docs");
  const nested = path.join(root, "nested");
  const nestedGit = path.join(state, "nested-git");
  const nestedDocs = path.join(nested, "docs");
  const inside = path.join(root, ".cache-probe");
  const outside = path.join(state, "external");
  const existingHelper = path.join(
    outside,
    "ropes",
    "stand-in",
    Bun.hash(binary).toString(16)
  );
  const alias = path.join(state, "checkout-alias");
  const nestedAlias = path.join(state, "nested-alias");
  const occupied = path.join(state, "not-a-directory");
  await Promise.all(
    [docs, existingHelper, nestedAlias].map((folder) =>
      mkdir(folder, { recursive: true })
    )
  );
  await Promise.all([
    Bun.write(path.join(root, "README.md"), contents),
    Bun.write(path.join(docs, "overview.md"), contents),
    Bun.write(occupied, "unusable cache"),
    symlink(root, alias),
    symlink(root, path.join(nestedAlias, "ropes")),
  ]);
  // A helper entry hard-linked to a tracked file must be replaced in the cache.
  await link(path.join(root, "README.md"), path.join(existingHelper, "bun"));
  await run(["git", "init", "-q"], root);
  await run([binary, "init", "--yes"], root);
  await run(["git", "add", "-A"], root);
  await mkdir(nestedDocs, { recursive: true });
  await run(["git", "init", "-q", "--separate-git-dir", nestedGit], nested);
  await Bun.write(path.join(nestedDocs, "overview.md"), contents);
  await fixtureGit(nested, "add", ".");
  await fixtureGit(nested, "commit", "--quiet", "--message", "fixture");
  await run([binary, "init", "--yes"], nested);
  await run(["git", "add", "-A"], nested);
  const index = Bun.file(path.join(root, ".git", "index"));
  const baselineIndex = new Uint8Array(await index.arrayBuffer());
  const nestedIndex = Bun.file(path.join(nestedGit, "index"));
  const baselineNestedIndex = new Uint8Array(await nestedIndex.arrayBuffer());
  const baselineTree = await readdir(root, { recursive: true });
  const listing = await run(["git", "ls-files", "-z"], root);
  const tracked = listing.stdout.split("\0").filter(Boolean);
  const snapshot = () =>
    Promise.all(
      tracked.map(async (name) => {
        const file = path.join(root, name);
        const metadata = await stat(file);
        return { contents: await Bun.file(file).text(), mode: metadata.mode };
      })
    );
  const baselineFiles = await snapshot();

  const cases = [
    { cache: "", name: "empty" },
    { cache: ".cache-probe", name: "relative" },
    { cache: inside, name: "checkout" },
    { cache: inside, cwd: nestedDocs, name: "enclosing-checkout" },
    { cache: path.join(alias, ".cache-probe"), name: "alias" },
    { cache: nestedAlias, name: "nested-alias" },
    { cache: outside, kept: outside, name: "external" },
    { cache: inside, home: root, incomplete: true, name: "home-in-checkout" },
    { cache: occupied, incomplete: true, name: "unusable" },
    { cache: "", home: "elsewhere", incomplete: true, name: "relative-home" },
  ];
  for (const trial of cases) {
    const defaultHome = path.join(state, trial.name);
    const home = trial.home ?? defaultHome;
    const expected = trial.incomplete === true ? 2 : 0;
    const env = { HOME: home, XDG_CACHE_HOME: trial.cache };
    // eslint-disable-next-line no-await-in-loop -- compare each command against the same initial checkout
    const result = await run(
      [binary, "check", "overview.md", "--json"],
      trial.cwd ?? docs,
      expected,
      env
    );
    if (trial.incomplete === true) {
      expect(result.stdout).toContain("incomplete");
    } else {
      // eslint-disable-next-line no-await-in-loop -- this case must use its own cache
      const installed = await helpers(trial.kept ?? path.join(home, ".cache"));
      expect(installed).toHaveLength(1);
    }
    // eslint-disable-next-line no-await-in-loop -- verify the current trial before the next runs
    const tree = await readdir(root, { recursive: true });
    expect(tree.toSorted()).toEqual(baselineTree.toSorted());
    // eslint-disable-next-line no-await-in-loop -- check the exact bytes instead of assuming Git updated nothing
    expect(new Uint8Array(await index.arrayBuffer())).toEqual(baselineIndex);
    // eslint-disable-next-line no-await-in-loop -- check the separately stored nested index too
    expect(new Uint8Array(await nestedIndex.arrayBuffer())).toEqual(
      baselineNestedIndex
    );
    // eslint-disable-next-line no-await-in-loop -- prove tracked contents and modes too
    const files = await snapshot();
    expect(files).toEqual(baselineFiles);
  }
};
