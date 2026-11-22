import { expect, test } from "bun:test";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { bunFmtAdapter } from "../src/adapters/bun-fmt/adapter.ts";
import { readFacts } from "../src/adapters/bun-fmt/facts.ts";
import { adaptersFor } from "../src/adapters/registry.ts";
import { rumdlAdapter } from "../src/adapters/rumdl/adapter.ts";
import { observeFacts } from "../src/runner/facts.ts";

const inRepo = async (body: (root: string) => Promise<void>) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "fmt-facts-")));
  try {
    await Bun.write(path.join(root, "a.ts"), "const a = 1;\n");
    await Bun.write(path.join(root, "README.md"), "# Guide\n");
    await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("the formatter reports the config native discovery chose and ignores a sibling", async () => {
  await inRepo(async (root) => {
    await Bun.write(path.join(root, ".prettierrc.json"), '{"printWidth":47}\n');
    await Bun.write(path.join(root, ".oxfmtrc.json"), '{"printWidth":100}\n');
    const report = await readFacts(process.execPath, root, ["a.ts"]);
    expect(report).toMatchObject({
      facts: [
        {
          evidence: "config-read",
          file: ".oxfmtrc.json",
          name: "line_width",
          path: "a.ts",
          value: 100,
        },
      ],
      ok: true,
    });
    if (report.ok) {
      expect(report.limitations?.join("\n")).toContain(
        "does not expose its resolved printWidth"
      );
    }
  });
});

test("Bun's own fmt setting overrides the selected static compatibility config", async () => {
  await inRepo(async (root) => {
    await Bun.write(
      path.join(root, ".prettierrc.json"),
      '{"printWidth":120}\n'
    );
    await Bun.write(
      path.join(root, "bunfig.toml"),
      "[fmt]\nprintWidth = 100\n"
    );
    const report = await readFacts(process.execPath, root, ["a.ts"]);
    expect(report).toMatchObject({
      facts: [{ file: "bunfig.toml", key: "fmt.printWidth", value: 100 }],
      ok: true,
    });
  });
});

test("native file discovery follows a nearer config for a nested selected path", async () => {
  await inRepo(async (root) => {
    await Bun.write(
      path.join(root, ".prettierrc.json"),
      '{"printWidth":100}\n'
    );
    await Bun.write(
      path.join(root, "sub", ".prettierrc.json"),
      '{"printWidth":120}\n'
    );
    await Bun.write(path.join(root, "sub", "b.ts"), "const b = 2;\n");
    expect(
      await readFacts(process.execPath, root, ["a.ts", "sub/b.ts"])
    ).toMatchObject({
      facts: [
        { file: ".prettierrc.json", path: "a.ts", value: 100 },
        { file: "sub/.prettierrc.json", path: "sub/b.ts", value: 120 },
      ],
      ok: true,
    });
  });
});

test("dynamic options and per-file overrides expose a verification limit", async () => {
  await inRepo(async (root) => {
    await Bun.write(
      path.join(root, "prettier.config.js"),
      'import { writeFileSync } from "node:fs"; writeFileSync("discovery-side-effect", "executed"); export default { printWidth: 100 };\n'
    );
    expect(await readFacts(process.execPath, root)).toMatchObject({
      facts: [],
      ok: true,
    });
    expect(
      await Bun.file(path.join(root, "discovery-side-effect")).exists()
    ).toBe(false);
    const dynamic = await readFacts(process.execPath, root, ["a.ts"]);
    expect(dynamic).toMatchObject({ facts: [], ok: true });
    if (dynamic.ok) {
      expect(dynamic.limitations?.join("\n")).toContain(
        "native discovery may execute"
      );
    }
    expect(
      await Bun.file(path.join(root, "discovery-side-effect")).exists()
    ).toBe(false);
    await rm(path.join(root, "prettier.config.js"));
    await Bun.write(
      path.join(root, ".prettierrc.json"),
      '{"printWidth":100,"overrides":[{"files":"*.ts","options":{"printWidth":120}}]}\n'
    );
    const override = await readFacts(process.execPath, root, ["a.ts"]);
    expect(override).toMatchObject({ facts: [], ok: true });
    if (override.ok) {
      expect(override.limitations?.join("\n")).toContain(
        "per-file formatter overrides"
      );
    }
  });
});

test("native and config-read observations keep separate source evidence", async () => {
  if (Bun.which("rumdl") === null) {
    console.warn(
      "skipped: rumdl is required for the two-tool shared-setting proof"
    );
    return;
  }
  await inRepo(async (root) => {
    await Bun.write(
      path.join(root, ".rumdl.toml"),
      "[global]\nline-length = 100\n"
    );
    await Bun.write(
      path.join(root, ".prettierrc.json"),
      '{"printWidth":100}\n'
    );
    const adapters = [
      rumdlAdapter(),
      bunFmtAdapter({ command: process.execPath }),
    ];
    const observations = await observeFacts(
      {
        reporters: adapters.map(({ descriptor }) => ({
          adapter: descriptor.id,
          reports: ["line_width"],
          tool: descriptor.tool,
        })),
        stated: [],
      },
      root,
      (id) =>
        Promise.resolve(
          adapters.find(({ descriptor }) => descriptor.id === id)
        ),
      adapters.map(({ descriptor }) => ({
        adapter: descriptor.id,
        package: ".",
        paths: [descriptor.id === "rumdl" ? "README.md" : "a.ts"],
        tool: descriptor.tool,
        versionRange: "*",
        writes: false,
      }))
    );
    expect(observations[0]?.facts[0]).toMatchObject({
      evidence: "engine-confirmed",
      value: 100,
    });
    expect(observations[1]?.facts[0]).toMatchObject({
      evidence: "config-read",
      value: 100,
    });
  });
});

test("registered formatter compatibility configs are inspected without evaluation", async () => {
  await inRepo(async (root) => {
    await Bun.write(
      path.join(root, "oxfmt.config.js"),
      'import {writeFileSync} from "node:fs"; writeFileSync("sentinel", "executed"); export default {printWidth: 100};\n'
    );
    const formatter = adaptersFor({}).find(
      ({ descriptor }) => descriptor.id === "bun-fmt"
    );
    const observed = await formatter?.facts?.(root, ["a.ts"]);
    expect(observed).toMatchObject({ facts: [], ok: true });
    expect(await Bun.file(path.join(root, "sentinel")).exists()).toBe(false);
  });
});

test.skipIf(process.platform === "win32")(
  "multi-file observation bounds child processes and the doctor argument list",
  async () => {
    await inRepo(async (root) => {
      await Bun.write(
        path.join(root, ".prettierrc.json"),
        '{"printWidth":100}\n'
      );
      const command = path.join(root, "observe-bun");
      await Bun.write(
        command,
        `#!/bin/sh
if ! /bin/mkdir "$0.active" 2>/dev/null; then exit 70; fi
trap '/bin/rmdir "$0.active"' EXIT
/bin/sleep 0.01
printf '.' >> "$0.calls"
if [ "$3" = "--doctor" ]; then
  printf '%s' "$#" > "$0.doctor-argc"
  printf '{"config":{"bunfig":null,"path":".prettierrc.json"}}'
else
  printf '.prettierrc.json'
fi
`
      );
      await chmod(command, 0o755);
      const paths = Array.from(
        { length: 32 },
        (_, index) => `file-${index}.ts`
      );
      const observed = await readFacts(command, root, paths);
      expect(observed.ok).toBe(true);
      if (observed.ok) {
        expect(observed.facts.map((fact) => fact.path)).toEqual(paths);
      }
      expect(await Bun.file(`${command}.doctor-argc`).text()).toBe("6");
      expect(await Bun.file(`${command}.calls`).text()).toBe("..");
    });
  }
);
