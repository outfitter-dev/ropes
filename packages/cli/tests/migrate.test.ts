import { expect } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";

import {
  CONFIG,
  json,
  proof,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";
import manifest from "../package.json" with { type: "json" };

const ROPE = new URL(manifest.bin.rope, new URL("../", import.meta.url));
const NEXT = ".ropes/configs";

for (const source of ["cinch.toml", "outfitter.toml"]) {
  proof(
    `manual guidance preserves the retired ${source} and every authored file`,
    async ({ main }) => {
      await rm(path.join(main.root, "rope.toml"));
      const standalone =
        'pilot = 0\nexclude = [".ropes/**"]\n[[overrides]]\npaths = [".outfitter/configs/**"]\n[overrides.toml]\nenabled = false\n';
      const original =
        source === "cinch.toml"
          ? standalone
          : `[another]\nkept = true\n[cinch]\n${standalone}`;
      await Bun.write(path.join(main.root, source), original);
      await Bun.write(
        path.join(main.root, ".outfitter/configs/authored.toml"),
        "# Original managed input\n"
      );
      const before = await main.files();
      const index = await Bun.file(path.join(main.root, ".git/index")).bytes();
      for (const flags of [[], ["--dry-run"]]) {
        // eslint-disable-next-line no-await-in-loop -- verify both accepted guidance invocations
        const ran = await runEntry(
          ROPE,
          ["migrate", ...flags, "--json"],
          main.root
        );
        expect(ran.exitCode).toBe(2);
        expect(ran.stdout).toBe("");
        expect(ran.stderr).toContain("Manual migration required");
        expect(ran.stderr).toContain("docs/config-migration.md");
        expect(ran.stderr).toContain(NEXT);
        // eslint-disable-next-line no-await-in-loop -- preserve authored content after each guidance run
        expect(await main.files()).toEqual(before);
        // eslint-disable-next-line no-await-in-loop -- preserve staged changes as well as working files
        const afterIndex = await Bun.file(
          path.join(main.root, ".git/index")
        ).bytes();
        expect(afterIndex).toEqual(index);
      }
    }
  );
}

proof(
  "a supported Ropes config places enabled presets and root references in the Ropes layout",
  async ({ main }) => {
    await Bun.write(
      path.join(main.root, "rope.toml"),
      "pilot = 0\n[lint]\npreset = true\n[format]\npreset = true\n[typescript]\npreset = true\n"
    );
    await Bun.write(
      path.join(main.root, "node_modules/ultracite/package.json"),
      '{"name":"ultracite","version":"8.1.1"}'
    );
    const setup = await main.rope(["doctor", "--fix"]);
    expect(setup.exitCode).toBe(0);
    const references = [
      [".rumdl.toml", "rumdl.toml"],
      ["oxlint.config.ts", "presets/oxlint.ts"],
      ["oxfmt.config.ts", "presets/oxfmt.ts"],
      ["tsconfig.json", "presets/tsconfig.json"],
    ];
    await Promise.all(
      references.map(async ([root = "", preset = ""]) => {
        const text = await Bun.file(path.join(main.root, root)).text();
        expect(text).toContain(`${NEXT}/${preset}`);
      })
    );
  }
);

proof(
  "supported policy preserves inherited overridden and excluded path decisions after a manual conversion",
  async ({ main }) => {
    const config = CONFIG.replace(
      "pilot = 0",
      'pilot = 0\nexclude = ["ignored/**"]'
    );
    await Bun.write(path.join(main.root, "rope.toml"), config);
    await Bun.write(
      path.join(main.root, "ignored/notes.md"),
      "# Ignored\n\nText.\n"
    );
    const setup = await main.rope(["doctor", "--fix"]);
    expect(setup.exitCode).toBe(0);
    const before = await main.files();
    const planned = await runEntry(
      ROPE,
      ["explain", "README.md", "legacy/old.md", "ignored/notes.md", "--json"],
      main.root
    );
    expect(planned.exitCode).toBe(0);
    expect(json(planned)).toMatchObject({
      paths: [
        { path: "README.md", steps: [{ adapter: "rumdl" }] },
        { path: "ignored/notes.md", skipped: { reason: "excluded" } },
        { path: "legacy/old.md", steps: [] },
      ],
    });
    const doctor = await main.rope(["doctor"]);
    expect(doctor.exitCode).toBe(0);
    expect(await main.files()).toEqual(before);
  }
);

proof(
  "shared retired policy is refused beside rope.toml without altering unrelated tables",
  async ({ main }) => {
    const original = "[another]\nenabled = true\n\n[cinch]\npilot = 0\n";
    await Bun.write(path.join(main.root, "outfitter.toml"), original);
    const before = await main.files();
    const checked = await runEntry(ROPE, ["check", "--json"], main.root);
    expect(checked.exitCode).toBe(2);
    expect(checked.stderr).toContain("[cinch]");
    expect(checked.stderr).toContain("docs/config-migration.md");
    expect(checked.stderr).toContain("rope.toml");
    const migration = await runEntry(ROPE, ["migrate", "--json"], main.root);
    expect(migration.exitCode).toBe(2);
    expect(migration.stdout).toBe("");
    expect(migration.stderr).toContain("Preserve unrelated tables");
    expect(await main.files()).toEqual(before);
  }
);
