import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chosenFiles } from "../src/adapters/rumdl/markdownlint-files.ts";
import { starterConfig, STARTER_CONFIG } from "../src/commands/starter.ts";
import { loadConfig } from "../src/config/load.ts";
import { compileGlobs } from "../src/policy/glob.ts";

const RUNNER = ".markdownlint-cli2.jsonc";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cinch-files-"));
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const chosen = async (table: unknown, file = RUNNER) => {
  await Bun.write(path.join(root, file), JSON.stringify(table));
  return await chosenFiles(root);
};

test("ignores become exclude, and a directory covers what is under it", async () => {
  const found = await chosen({
    ignores: ["**/CHANGELOG.md", "**/dist", ".scratch/**", "./vendor"],
  });
  expect(found).toEqual({
    exclude: [
      "**/CHANGELOG.md",
      "**/dist",
      "**/dist/**",
      ".scratch/**",
      "vendor",
      "vendor/**",
    ],
    from: RUNNER,
    include: [],
    notes: [],
  });
  const excluded = compileGlobs(found?.exclude ?? []);
  expect(excluded("packages/a/dist/notes.md")).toBe(true);
  expect(excluded("vendor/x/README.md")).toBe(true);
  expect(excluded("docs/dist.md")).toBe(false);
});

test("a trailing slash or a dot in a directory name still covers its contents", async () => {
  const found = await chosen({ ignores: ["dist/", "docs/v1.0", "a.min.md"] });
  expect(found?.exclude).toEqual([
    "dist",
    "dist/**",
    "docs/v1.0",
    "docs/v1.0/**",
    "a.min.md",
  ]);
  const excluded = compileGlobs(found?.exclude ?? []);
  expect(excluded("dist/README.md")).toBe(true);
  expect(excluded("docs/v1.0/notes.md")).toBe(true);
});

test("the root, however it is spelled, is everything", async () => {
  const found = await chosen({ globs: [".", "./"], ignores: ["./out/"] });
  expect(found).toMatchObject({
    exclude: ["out", "out/**"],
    include: ["**"],
  });
});

test("globs become include, and a negated glob becomes exclude", async () => {
  const found = await chosen({
    globs: ["**/*.md", "**/*.mdx", "!drafts"],
  });
  expect(found).toMatchObject({
    exclude: ["drafts", "drafts/**"],
    include: ["**/*.md", "**/*.mdx"],
  });
});

test("globs that say what Cinch already does are left out", async () => {
  expect(await chosen({ globs: ["**/*.md"] })).toBeNull();
  expect(
    await chosen({ config: { MD013: false }, gitignore: true })
  ).toBeNull();
});

test("a pattern a Cinch glob cannot say is noted and not written", async () => {
  const found = await chosen({
    globs: ["#keep.md"],
    ignores: ["/abs/**", "../up/**", "+(a|b)/**", "ok/**"],
  });
  expect(found?.exclude).toEqual(["ok/**"]);
  expect(found?.include).toEqual([]);
  expect(found?.notes).toEqual([
    '"#keep.md" in `globs` was not carried over, because a Cinch glob cannot say it.',
    '"/abs/**" in `ignores` was not carried over, because a Cinch glob cannot say it.',
    '"../up/**" in `ignores` was not carried over, because a Cinch glob cannot say it.',
    '"+(a|b)/**" in `ignores` was not carried over, because a Cinch glob cannot say it.',
  ]);
});

test("a setting that is not a list of globs is noted", async () => {
  const found = await chosen({ ignores: "dist" });
  expect(found?.notes).toEqual([
    "`ignores` is not a list of globs, so it was not read.",
  ]);
});

test("a script config is never read for file choices", async () => {
  await Bun.write(
    path.join(root, ".markdownlint-cli2.mjs"),
    'export default { ignores: ["dist"] };'
  );
  expect(await chosenFiles(root)).toBeNull();
  expect(await chosen({ ignores: ["dist"] })).toBeNull();
});

test("no runner config means nothing to carry over", async () => {
  expect(await chosenFiles(root)).toBeNull();
});

test("the starter config with nothing carried over is the plain starter", () => {
  expect(starterConfig([])).toBe(STARTER_CONFIG);
});

test("the starter config states carried choices once and loads", async () => {
  const text = starterConfig([
    {
      exclude: ["dist", "dist/**"],
      from: RUNNER,
      include: ["**/*.md", "**/*.mdx"],
      notes: ['"/abs" in `ignores` was not carried over.'],
    },
    { exclude: ["dist", "out/**"], from: "other.json", include: [], notes: [] },
  ]);
  expect(text.match(/^exclude = \[$/gmu)).toHaveLength(1);
  expect(text).toContain(
    `# From ${RUNNER}: "/abs" in \`ignores\` was not carried over.`
  );
  await Bun.write(path.join(root, "cinch.toml"), text);
  const loaded = await loadConfig(root);
  expect(loaded).toMatchObject({
    ok: true,
    value: {
      exclude: { value: ["dist", "dist/**", "out/**"] },
      include: { value: ["**/*.md", "**/*.mdx"] },
    },
  });
});
