import { expect, test } from "bun:test";
import path from "node:path";

import { z } from "zod";

import { render } from "../src/adapters/bun-install/read.ts";
import { adaptersFor } from "../src/adapters/registry.ts";
import { createCommands } from "../src/commands/registry.ts";
import { InstallSchema } from "../src/contracts/install.ts";
import {
  INSTALL_CONFIG,
  INSTALL_SETTINGS,
  withInstallFixture,
} from "./install-fixture.ts";

const commands = createCommands({ adapters: adaptersFor });

test("marked Bun files with native additions remain authored during repair", async () => {
  const bunfig = `${render(INSTALL_SETTINGS)}\n[test]\ncoverage = true\n`;
  await withInstallFixture(
    { "bunfig.toml": bunfig, "rope.toml": INSTALL_CONFIG },
    async (root) => {
      const request = { cwd: root, fix: true, json: true, paths: [] };
      const matched = await commands.doctor?.(request);
      expect(matched?.exitCode).toBe(0);
      expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(
        bunfig
      );
      const drifted = bunfig.replace("604800", "60");
      await Bun.write(path.join(root, "bunfig.toml"), drifted);
      const drift = await commands.doctor?.(request);
      expect(drift?.exitCode).toBe(1);
      expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(
        drifted
      );
      const adoption = await commands.preset?.({
        action: "adopt",
        cwd: root,
        json: true,
        paths: ["install"],
        yes: true,
      });
      expect(adoption?.exitCode).toBe(1);
      expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(
        drifted
      );
    }
  );
});

test("doctor still repairs generated files containing only owned install fields", async () => {
  await withInstallFixture(
    {
      "bunfig.toml": render(INSTALL_SETTINGS).replace("604800", "60"),
      "rope.toml": INSTALL_CONFIG,
    },
    async (root) => {
      const repaired = await commands.doctor?.({
        cwd: root,
        fix: true,
        json: true,
        paths: [],
      });
      expect(repaired?.exitCode).toBe(0);
      expect(await Bun.file(path.join(root, "bunfig.toml")).text()).toBe(
        render(INSTALL_SETTINGS)
      );
    }
  );
});

for (const file of [
  "renovate.jsonc",
  ".github/renovate.jsonc",
  ".gitlab/renovate.jsonc",
  ".renovaterc.jsonc",
]) {
  test(`doctor compares the active JSONC config at ${file}`, async () => {
    const text = '{\n// Authored config.\n"minimumReleaseAge":"3 days",\n}\n';
    await withInstallFixture(
      {
        "bunfig.toml": render(INSTALL_SETTINGS),
        [file]: text,
        "rope.toml": INSTALL_CONFIG,
      },
      async (root) => {
        const drift = await commands.doctor?.({
          cwd: root,
          fix: true,
          json: true,
          paths: [],
        });
        expect(drift?.exitCode).toBe(1);
        expect(drift?.output).toContain("Renovate minimumReleaseAge differs");
        expect(await Bun.file(path.join(root, file)).text()).toBe(text);
      }
    );
  });
}

test("only the first active Renovate config affects doctor", async () => {
  await withInstallFixture(
    {
      ".renovaterc.json": '{"minimumReleaseAge":"1 day"}',
      "bunfig.toml": render(INSTALL_SETTINGS),
      "renovate.jsonc": '{"minimumReleaseAge":"7 days"}',
      "rope.toml": INSTALL_CONFIG,
    },
    async (root) => {
      const inspected = await commands.doctor?.({
        cwd: root,
        json: true,
        paths: [],
      });
      expect(inspected?.exitCode).toBe(0);
      expect(inspected?.output).not.toContain(".renovaterc.json");
    }
  );
});

test("doctor comparison leaves authored JSON formatting for an ordinary fix", async () => {
  if (Bun.which("bun") === null) {
    console.warn("skipped: authored config formatting needs Bun on PATH");
    return;
  }
  const config = `${INSTALL_CONFIG.replace("pilot = 0", 'pilot = 0\ninclude = ["**/*.json", "**/*.toml"]')}\n[format]\nenabled = true\n`;
  const renovate = '{"minimumReleaseAge":"7 days","enabledManagers":["npm"]}';
  await withInstallFixture(
    {
      "bunfig.toml": render(INSTALL_SETTINGS),
      "renovate.json": renovate,
      "rope.toml": config,
    },
    async (root) => {
      const request = { cwd: root, json: true, paths: [] };
      const doctor = await commands.doctor?.({ ...request, fix: true });
      expect(doctor?.exitCode).toBe(0);
      expect(await Bun.file(path.join(root, "renovate.json")).text()).toBe(
        renovate
      );
      const fixed = await commands.fix?.({
        ...request,
        paths: ["renovate.json"],
      });
      expect(fixed?.exitCode).toBe(0);
      expect(await Bun.file(path.join(root, "renovate.json")).text()).not.toBe(
        renovate
      );
      const checked = await commands.check?.({
        ...request,
        paths: ["renovate.json"],
      });
      expect(checked?.exitCode).toBe(0);
    }
  );
});

test("published exemption constraints agree with the loader including unspaced unions", () => {
  const schema = z
    .object({
      properties: z.object({
        release_age_exempt: z.object({
          items: z.object({ pattern: z.string() }),
        }),
      }),
    })
    .parse(z.toJSONSchema(InstallSchema));
  const pattern = new RegExp(
    schema.properties.release_age_exempt.items.pattern,
    "u"
  );
  for (const value of [
    "pkg",
    "@scope/pkg",
    "pkg@1.2.3||1.2.4",
    "pkg@1.2.3 || 2.0.0-beta.1",
    "pkg@^1",
    "pkg@01.2.3",
    "@scope/*",
    "pkg@latest",
  ]) {
    expect(pattern.test(value)).toBe(
      InstallSchema.safeParse({ release_age_exempt: [value] }).success
    );
  }
  expect(pattern.test("pkg@1.2.3||1.2.4")).toBe(true);
  expect(pattern.test("pkg@^1")).toBe(false);
});
