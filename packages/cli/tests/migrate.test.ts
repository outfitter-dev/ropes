import { expect } from "bun:test";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  CONFIG,
  json,
  proof,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";
import manifest from "../package.json" with { type: "json" };

const ROPE = new URL(manifest.bin.rope, new URL("../", import.meta.url));
const SELECTION = ["README.md", "legacy/old.md", "ignored/notes.md"];
const LEGACY = ".outfitter/configs";
const NEXT = ".ropes/configs";

for (const [key, policy] of [
  ["exclude", 'exclude = [".ropes/**"]'],
  [
    "overrides.0.paths",
    '[[overrides]]\npaths = [".outfitter/configs/**"]\n[overrides.toml]\nenabled = false',
  ],
] as const) {
  proof(
    `flags ${key} when its coverage would change with the managed directory`,
    async ({ main }) => {
      await Bun.write(
        path.join(main.root, "cinch.toml"),
        `pilot = 0\n${policy}\n`
      );
      const before = await main.files();
      const ran = await runEntry(ROPE, ["migrate", "--json"], main.root);
      expect(ran.exitCode).toBe(2);
      expect(ran.stderr).toContain(key);
      expect(ran.stderr).toContain(NEXT);
      expect(await main.files()).toEqual(before);
    }
  );
}

proof(
  "a new Ropes config places enabled presets and root references in the Ropes layout",
  async ({ main }) => {
    await rm(path.join(main.root, "cinch.toml"));
    await Bun.write(
      path.join(main.root, "rope.toml"),
      "pilot = 0\n[lint]\npreset = true\n[format]\npreset = true\n[typescript]\npreset = true\n"
    );
    await Bun.write(
      path.join(main.root, "node_modules/ultracite/package.json"),
      '{"name":"ultracite","version":"8.1.1"}'
    );
    const setup = await main.cinch(["doctor", "--fix"]);
    expect(setup.exitCode).toBe(0);
    const references = [
      [".rumdl.toml", "rumdl.toml"],
      ["oxlint.config.ts", "presets/oxlint.ts"],
      ["oxfmt.config.ts", "presets/oxfmt.ts"],
      ["tsconfig.json", "presets/tsconfig.json"],
    ] as const;
    await Promise.all(
      references.map(async ([root, preset]) => {
        const text = await Bun.file(path.join(main.root, root)).text();
        expect(text).toContain(`${NEXT}/${preset}`);
      })
    );
  }
);

proof(
  "previews standalone config migration and resolves the same policy in both layouts",
  async ({ main }) => {
    const join = (file: string) => path.join(main.root, file);
    const legacyConfig = CONFIG.replace(
      "pilot = 0",
      'pilot = 0\nexclude = ["ignored/**"]'
    );
    await Bun.write(join("cinch.toml"), legacyConfig);
    await Bun.write(join("ignored/notes.md"), "# Ignored\n\nText.\n");
    const setup = await main.cinch(["doctor", "--fix"]);
    expect(setup.exitCode).toBe(0);
    const before = await main.files();

    const preview = await runEntry(
      ROPE,
      ["migrate", "--dry-run", "--json"],
      main.root
    );
    expect(preview.exitCode).toBe(0);
    expect(json(preview)).toMatchObject({
      managedFiles: [
        {
          from: `${LEGACY}/presets/rumdl.toml`,
          to: `${NEXT}/presets/rumdl.toml`,
        },
        { from: `${LEGACY}/rumdl.toml`, to: `${NEXT}/rumdl.toml` },
      ],
      rootReferences: [
        {
          from: `${LEGACY}/rumdl.toml`,
          path: ".rumdl.toml",
          to: `${NEXT}/rumdl.toml`,
        },
      ],
      schemaVersion: 1,
      source: { path: "cinch.toml" },
      target: { path: "rope.toml", text: legacyConfig },
    });
    expect(await main.files()).toEqual(before);

    const args = ["explain", ...SELECTION, "--json"];
    const legacyPlan = await runEntry(ROPE, args, main.root);
    expect(legacyPlan.exitCode).toBe(0);
    await rename(join("cinch.toml"), join("rope.toml"));
    await mkdir(join(".ropes"));
    await rename(join(LEGACY), join(NEXT));
    const root = await Bun.file(join(".rumdl.toml")).text();
    await Bun.write(join(".rumdl.toml"), root.replaceAll(LEGACY, NEXT));
    const newPlan = await runEntry(ROPE, args, main.root);
    expect(newPlan.exitCode).toBe(0);
    expect(newPlan.stdout).toContain('"file": "rope.toml"');
    expect(
      JSON.parse(newPlan.stdout.replaceAll("rope.toml", "cinch.toml"))
    ).toEqual(json(legacyPlan));
    expect(json(newPlan)).toMatchObject({
      paths: [
        { path: "README.md", steps: [{ adapter: "rumdl" }] },
        { path: "ignored/notes.md", skipped: { reason: "excluded" } },
        { path: "legacy/old.md", steps: [] },
      ],
    });
    const doctor = await main.cinch(["doctor"]);
    expect(doctor.exitCode).toBe(0);
  }
);

proof(
  "previews the shared table alone and reports a competing config without writes",
  async ({ main }) => {
    await rm(path.join(main.root, "cinch.toml"));
    await Bun.write(
      path.join(main.root, "outfitter.toml"),
      "[another]\nenabled = true\n\n[cinch]\npilot = 0\n"
    );
    const before = await main.files();
    const preview = await runEntry(ROPE, ["migrate", "--json"], main.root);
    expect(preview.exitCode).toBe(0);
    expect(json(preview)).toMatchObject({
      source: { path: "outfitter.toml", table: "cinch" },
      target: { path: "rope.toml", text: "pilot = 0\n" },
    });
    expect(await main.files()).toEqual(before);
    await Bun.write(path.join(main.root, "rope.toml"), "pilot = 0\n");
    const conflicted = await main.files();
    const command = await runEntry(ROPE, ["migrate", "--json"], main.root);
    expect(command.exitCode).toBe(2);
    expect(command.stdout).toBe("");
    expect(command.stderr).toContain("outfitter.toml");
    expect(command.stderr).toContain("rope.toml");
    expect(await main.files()).toEqual(conflicted);
  }
);
