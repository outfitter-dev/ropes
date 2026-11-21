import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { bunInstallAdapter } from "../src/adapters/bun-install/adapter.ts";
import { readInstall, render } from "../src/adapters/bun-install/read.ts";
import { adaptersFor } from "../src/adapters/registry.ts";
import { createCommands } from "../src/commands/registry.ts";
import { DoctorReportSchema } from "../src/contracts/doctor.ts";
import { InstallSchema } from "../src/contracts/install.ts";

const SETTINGS = { isolated: true, minimum_release_age: "7 days" };
const CONFIG = `pilot = 0
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[install]
isolated = true
minimum_release_age = "7 days"
`;

const fixture = async (
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>
) => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-install-"));
  try {
    await mkdir(path.join(root, ".git"));
    await Promise.all(
      Object.entries(files).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("install policy validates fixed units and deliberate package exceptions", () => {
  expect(
    InstallSchema.safeParse({ minimum_release_age: "7 months" }).success
  ).toBe(false);
  expect(
    InstallSchema.safeParse({ release_age_exempt: ["@outfitter/*"] }).success
  ).toBe(false);
  expect(
    InstallSchema.safeParse({ release_age_exempt: ["tsrs@^7"] }).success
  ).toBe(false);
  expect(
    InstallSchema.parse({
      release_age_exempt: ["@outfitter/tool", "tsrs@7.1.0-beta.tsrs3"],
    }).release_age_exempt
  ).toHaveLength(2);
  expect(
    readInstall('[install]\nlinker = "isolated"\nminimumReleaseAge = 604800\n')
  ).toEqual({
    isolated: true,
    minimum_release_age: "604800 seconds",
  });
});

test("doctor generates an equivalent authored install-only file and preserves mixed files", async () => {
  const commands = createCommands({ adapters: adaptersFor });
  await fixture(
    {
      "bunfig.toml":
        '# Authored.\n[install]\nlinker = "isolated"\nminimumReleaseAge = 604800\n',
      "cinch.toml": CONFIG,
    },
    async (root) => {
      const request = { cwd: root, json: true, paths: [] };
      const before = await Bun.file(path.join(root, "bunfig.toml")).text();
      const inspected = await commands.doctor?.(request);
      expect(inspected?.exitCode).toBe(1);
      expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(
        before
      );
      const preview = await commands.doctor?.({
        ...request,
        dryRun: true,
        fix: true,
      });
      expect(preview?.exitCode).toBe(0);
      expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(
        before
      );
      const generated = await commands.doctor?.({ ...request, fix: true });
      expect(generated?.exitCode).toBe(0);
      expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(
        render(SETTINGS)
      );
      const again = await commands.doctor?.({ ...request, fix: true });
      expect(
        DoctorReportSchema.parse(JSON.parse(again?.output ?? "{}")).changed
      ).toEqual([]);
      const mixed = `${before}\n[test]\ncoverage = true\n`;
      await Bun.write(path.join(root, "bunfig.toml"), mixed);
      const preserved = await commands.doctor?.({ ...request, fix: true });
      expect(preserved?.exitCode).toBe(0);
      expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(mixed);
    }
  );
});

test("adoption previews both files, respects conflicts, and refuses settings it cannot retain", async () => {
  const { relocates } = bunInstallAdapter();
  if (relocates === undefined) {
    throw new Error("install adoption is unavailable");
  }
  await fixture(
    {
      "bunfig.toml":
        '[install]\nlinker = "isolated"\nminimumReleaseAge = 604800\n',
    },
    async (root) => {
      const config = { file: "rope.toml", prefix: "", text: "pilot = 0\n" };
      const adopted = await relocates.adopt(root, config);
      expect(adopted.ok).toBe(true);
      if (!adopted.ok) {
        throw new Error("expected lossless adoption");
      }
      expect(adopted.files.map((file) => file.path)).toEqual([
        "rope.toml",
        "bunfig.toml",
      ]);
      expect(adopted.files[0]?.text).toContain("[install]\nisolated = true");
      const conflicting = await relocates.adopt(root, {
        ...config,
        text: "pilot = 0\n[install]\nisolated = false\n",
      });
      expect(conflicting.ok).toBe(false);
      const before = await Bun.file(path.join(root, "bunfig.toml")).text();
      await Bun.write(
        path.join(root, "bunfig.toml"),
        `${before}\n[install.scopes]\nprivate = "https://registry.example"\n`
      );
      const mixed = await relocates.adopt(root, config);
      expect(mixed.ok).toBe(false);
    }
  );
});

test("doctor reports authored Renovate release-age drift without writing it", async () => {
  const commands = createCommands({ adapters: adaptersFor });
  const original = '{"minimumReleaseAge":"3 days","enabledManagers":["npm"]}\n';
  await fixture(
    {
      "bunfig.toml": render(SETTINGS),
      "cinch.toml": CONFIG,
      "renovate.json": original,
    },
    async (root) => {
      const request = { cwd: root, json: true, paths: [] };
      const drift = await commands.doctor?.({ ...request, fix: true });
      expect(drift?.exitCode).toBe(1);
      expect(drift?.output).toContain("Renovate minimumReleaseAge differs");
      expect(await Bun.file(path.join(root, "renovate.json")).text()).toBe(
        original
      );
      await Bun.write(
        path.join(root, "renovate.json"),
        '{"minimumReleaseAge":"168 hours"}\n'
      );
      const aligned = await commands.doctor?.(request);
      expect(aligned?.exitCode).toBe(0);
      await Bun.write(
        path.join(root, "renovate.json"),
        '{"extends":["config:recommended"]}\n'
      );
      const inherited = await commands.doctor?.(request);
      expect(inherited?.exitCode).toBe(2);
    }
  );
});

test("init carries install facts into a first config before doctor generates the file", async () => {
  if (Bun.which("rumdl") === null) {
    console.warn("skipped: init install migration needs the pinned rumdl");
    return;
  }
  const commands = createCommands({ adapters: adaptersFor });
  const original =
    '[install]\nlinker = "isolated"\nminimumReleaseAge = 604800\n';
  await fixture({ "bunfig.toml": original }, async (root) => {
    const request = { cwd: root, json: true, paths: [] };
    const preview = await commands.init?.(request);
    expect(preview?.exitCode).toBe(0);
    expect(await Bun.file(path.join(root, "cinch.toml")).exists()).toBe(false);
    expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(
      original
    );
    const applied = await commands.init?.({ ...request, yes: true });
    expect(applied?.exitCode).toBe(0);
    expect(await Bun.file(path.join(root, "cinch.toml")).text()).toContain(
      "[install]"
    );
    const generated = await commands.doctor?.({ ...request, fix: true });
    expect(generated?.exitCode).toBe(0);
    expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toStartWith(
      "# Generated by Cinch from `[install]`"
    );
  });
});
