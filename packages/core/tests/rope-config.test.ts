import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { markdownPaths } from "../src/adapters/rumdl/paths.ts";
import { pointerFor, POINTER } from "../src/adapters/rumdl/root-config.ts";
import { configFileIn, loadConfig } from "../src/config/load.ts";
import { discoverRoot } from "../src/config/root.ts";
import {
  LEGACY_MANAGED_DIR,
  ROPES_MANAGED_DIR,
} from "../src/contracts/managed-config.ts";

const withFiles = async <T>(
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<T>
): Promise<T> => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-config-"))
  );
  try {
    await Promise.all(
      Object.entries(files).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    return await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const VALID =
  'pilot = 0\ninclude = ["docs/**/*.md"]\nexclude = ["docs/vendor/**"]\n[[overrides]]\npaths = ["docs/legacy/**"]\n[overrides.markdown]\nenabled = false\n';

test("rope.toml reads the pilot schema and names its source", async () => {
  await withFiles({ "rope.toml": VALID }, async (root) => {
    expect(await configFileIn(root)).toBe("rope.toml");
    const loaded = await loadConfig(root);
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        exclude: {
          source: { file: "rope.toml", key: "exclude", kind: "file" },
          value: ["docs/vendor/**"],
        },
        file: "rope.toml",
        include: {
          source: { file: "rope.toml", key: "include", kind: "file" },
          value: ["docs/**/*.md"],
        },
        overrides: [
          {
            paths: ["docs/legacy/**"],
            settings: [
              {
                key: "markdown.enabled",
                source: {
                  file: "rope.toml",
                  key: "overrides.0.markdown.enabled",
                  kind: "file",
                },
                value: false,
              },
            ],
          },
        ],
      },
    });
  });
});

test.each([
  { files: { "cinch.toml": VALID, "rope.toml": VALID }, retired: "cinch.toml" },
  {
    files: { "outfitter.toml": "[cinch]\npilot = 0\n", "rope.toml": VALID },
    retired: "outfitter.toml",
  },
  {
    files: {
      "cinch.toml": VALID,
      "outfitter.toml": "[cinch]\npilot = 0\n",
      "rope.toml": VALID,
    },
    retired: "cinch.toml",
  },
])(
  "retired $retired is refused even beside rope.toml",
  async ({ files, retired }) => {
    await withFiles(files, async (root) => {
      expect(await loadConfig(root)).toMatchObject({
        error: { file: path.join(root, retired), kind: "legacy" },
        ok: false,
      });
      expect(await Bun.file(path.join(root, retired)).text()).toBe(
        files[retired] ?? ""
      );
    });
  }
);

test.each([
  { kind: "malformed", text: "pilot = = 0\n" },
  { kind: "missing-version", text: "include = []\n" },
  { kind: "unknown-version", text: "pilot = 1\n" },
  { kind: "invalid", text: "pilot = 0\nunknown = true\n" },
])("an invalid rope.toml reports $kind", async ({ text, kind }) => {
  await withFiles({ "rope.toml": text }, async (root) => {
    expect(await configFileIn(root)).toBe("rope.toml");
    expect(await loadConfig(root)).toMatchObject({
      error: { file: "rope.toml", kind },
      ok: false,
    });
  });
});

test("a shared file with no cinch table leaves rope.toml in charge", async () => {
  await withFiles(
    { "outfitter.toml": "[ropes]\npilot = 0\n", "rope.toml": VALID },
    async (root) => {
      expect(await configFileIn(root)).toBe("rope.toml");
      expect(await loadConfig(root)).toMatchObject({
        ok: true,
        value: { file: "rope.toml" },
      });
    }
  );
});

test.each([
  { file: "cinch.toml", kind: "legacy" },
  { file: "outfitter.toml", kind: "unreadable" },
])(
  "malformed retired or shared $file remains an error beside rope.toml",
  async ({ file, kind }) => {
    await withFiles(
      { [file]: "pilot = = 0\n", "rope.toml": VALID },
      async (root) => {
        expect(await loadConfig(root)).toMatchObject({
          error: { file: path.join(root, file), kind },
          ok: false,
        });
      }
    );
  }
);

test("a nested rope.toml sets the root when started farther below it", async () => {
  await withFiles(
    { "packages/app/rope.toml": VALID, "rope.toml": VALID },
    async (root) => {
      await mkdir(path.join(root, ".git"));
      await mkdir(path.join(root, "packages/app/src"));
      expect(
        await discoverRoot(path.join(root, "packages/app/src"))
      ).toMatchObject({
        ok: true,
        value: {
          configFile: "rope.toml",
          root: path.join(root, "packages/app"),
          startedIn: "src",
          vcsRoot: root,
        },
      });
    }
  );
});

test("rope.toml above a linked checkout is outside its boundary", async () => {
  await withFiles(
    { "linked/.git": "gitdir: ../.git/worktrees/linked\n", "rope.toml": VALID },
    async (root) => {
      expect(await discoverRoot(path.join(root, "linked"))).toMatchObject({
        ok: true,
        value: {
          configFile: null,
          root: path.join(root, "linked"),
          vcs: "git-linked",
        },
      });
    }
  );
});

test("generated Markdown pointers name the active setup command", () => {
  expect(pointerFor(markdownPaths(LEGACY_MANAGED_DIR))).toBe(POINTER);
  expect(POINTER).toContain("cinch doctor --fix");
  const ropes = pointerFor(markdownPaths(ROPES_MANAGED_DIR));
  expect(ropes).toContain("rope doctor --fix");
  expect(ropes).toContain("in the Ropes config");
});
