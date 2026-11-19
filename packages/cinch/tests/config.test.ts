import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../src/config/load.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

const withFiles = async <T>(
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<T>
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-config-"));
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

const load = (files: Readonly<Record<string, string>>) =>
  withFiles(files, loadConfig);

const VALID = `pilot = 0
include = ["docs/**/*.md"]
exclude = ["docs/vendor/**"]

[markdown]
enabled = true

[[overrides]]
paths = ["docs/legacy/**"]
[overrides.markdown]
enabled = false

[[overrides]]
paths = ["docs/legacy/keep.md"]
[overrides.markdown]
enabled = true
`;

test("no config file gives the defaults, each marked as a default", async () => {
  expect(await load({})).toEqual({ ok: true, value: DEFAULT_CONFIG });
  expect(DEFAULT_CONFIG.settings).toEqual([
    { key: "markdown.enabled", source: { kind: "default" }, value: true },
  ]);
});

test("a valid cinch.toml is read with the file and key behind each value", async () => {
  const loaded = await load({ "cinch.toml": VALID });
  expect(loaded).toEqual({
    ok: true,
    value: {
      exclude: {
        source: { file: "cinch.toml", key: "exclude", kind: "file" },
        value: ["docs/vendor/**"],
      },
      file: "cinch.toml",
      include: {
        source: { file: "cinch.toml", key: "include", kind: "file" },
        value: ["docs/**/*.md"],
      },
      overrides: [
        {
          paths: ["docs/legacy/**"],
          settings: [
            {
              key: "markdown.enabled",
              source: {
                file: "cinch.toml",
                key: "overrides.0.markdown.enabled",
                kind: "file",
              },
              value: false,
            },
          ],
        },
        {
          paths: ["docs/legacy/keep.md"],
          settings: [
            {
              key: "markdown.enabled",
              source: {
                file: "cinch.toml",
                key: "overrides.1.markdown.enabled",
                kind: "file",
              },
              value: true,
            },
          ],
        },
      ],
      settings: [
        {
          key: "markdown.enabled",
          source: { file: "cinch.toml", key: "markdown.enabled", kind: "file" },
          value: true,
        },
      ],
    },
  });
});

test("a value the file leaves out keeps its default", async () => {
  const loaded = await load({ "cinch.toml": "pilot = 0\n" });
  expect(loaded).toEqual({
    ok: true,
    value: { ...DEFAULT_CONFIG, file: "cinch.toml" },
  });
});

test("the [cinch] table in outfitter.toml is read, with keys under cinch", async () => {
  const loaded = await load({
    "outfitter.toml": "[cinch]\npilot = 0\n[cinch.markdown]\nenabled = false\n",
  });
  expect(loaded.ok && loaded.value.file).toBe("outfitter.toml");
  expect(loaded.ok && loaded.value.settings).toEqual([
    {
      key: "markdown.enabled",
      source: {
        file: "outfitter.toml",
        key: "cinch.markdown.enabled",
        kind: "file",
      },
      value: false,
    },
  ]);
});

test("an outfitter.toml without a [cinch] table does not shadow cinch.toml", async () => {
  const loaded = await load({
    "cinch.toml": "pilot = 0\n",
    "outfitter.toml": '[other]\nname = "x"\n',
  });
  expect(loaded.ok && loaded.value.file).toBe("cinch.toml");
});

test("cinch.toml beside a [cinch] table is a conflict, never a second source", async () => {
  expect(
    await load({
      "cinch.toml": "pilot = 0\n",
      "outfitter.toml": "[cinch]\npilot = 0\n",
    })
  ).toEqual({
    error: { files: ["outfitter.toml", "cinch.toml"], kind: "conflict" },
    ok: false,
  });
});

test("a missing version marker is an error", async () => {
  expect(await load({ "cinch.toml": "[markdown]\nenabled = true\n" })).toEqual({
    error: { file: "cinch.toml", kind: "missing-version" },
    ok: false,
  });
});

test("an unknown version marker is an error, never a guess", async () => {
  expect(await load({ "cinch.toml": "pilot = 1\n" })).toEqual({
    error: { file: "cinch.toml", found: 1, kind: "unknown-version" },
    ok: false,
  });
});

test("malformed TOML is reported with the file", async () => {
  const loaded = await load({ "cinch.toml": "pilot = = 0\n" });
  expect(loaded.ok ? {} : loaded.error).toMatchObject({
    file: "cinch.toml",
    kind: "malformed",
  });
});

test("an unknown key is invalid and names the key", async () => {
  const loaded = await load({ "cinch.toml": "pilot = 0\nmarkdwon = true\n" });
  expect(loaded.ok ? {} : loaded.error).toMatchObject({
    file: "cinch.toml",
    kind: "invalid",
  });
  expect(JSON.stringify(loaded)).toContain("markdwon");
});

test("this repository's own cinch.toml loads", async () => {
  const loaded = await loadConfig(REPO_ROOT);
  expect(loaded.ok && loaded.value.file).toBe("cinch.toml");
});
