import { expect, test } from "bun:test";
import path from "node:path";

import { parseResult } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import { BEFORE, CONFIG, packageAt } from "./compatibility-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("compatibility rejects disabled semantic checks and referenced compiler projects", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    const directory = await packageAt(main.root, "current", "^5.0.0");
    await Bun.write(path.join(directory, "index.ts"), BEFORE);
    const run = async (config: unknown, reason: string) => {
      await Bun.write(
        path.join(directory, "tsconfig.json"),
        JSON.stringify(config)
      );
      const ran = await runEntry(
        ROPE,
        ["check", "packages/current/index.ts", "--json"],
        main.root
      );
      expect(ran.exitCode).toBe(2);
      const result = parseResult(json(ran));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.steps[0]?.reason).toContain(reason);
      }
    };
    await run(
      {
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          noCheck: true,
        },
      },
      "noCheck disables"
    );
    await Bun.write(
      path.join(directory, "shim.ts"),
      "export interface Map<T> { value: T }\n"
    );
    await Bun.write(
      path.join(directory, "tsconfig.app.json"),
      JSON.stringify({
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          paths: { typescript: ["./shim.ts"] },
        },
        include: ["index.ts"],
      })
    );
    await run(
      {
        compilerOptions: { module: "esnext", moduleResolution: "bundler" },
        files: [],
        references: [{ path: "./tsconfig.app.json" }],
      },
      "project references"
    );
  });
});

test("compatibility advertises only resolution modes the pinned checker accepts", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Promise.all(
      [
        { exit: 1, mode: "bundler", module: "esnext" },
        { exit: 1, mode: "node16", module: "node16" },
        { exit: 1, mode: "nodenext", module: "nodenext" },
        { exit: 2, mode: "node", module: "commonjs" },
        { exit: 2, mode: "node10", module: "commonjs" },
      ].map(async ({ mode, module, exit }) => {
        const directory = await packageAt(main.root, mode, "^5.0.0");
        await Bun.write(path.join(directory, "index.ts"), BEFORE);
        await Bun.write(
          path.join(directory, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              module,
              moduleResolution: mode,
              skipLibCheck: true,
            },
          })
        );
        const ran = await runEntry(
          ROPE,
          ["check", `packages/${mode}/index.ts`, "--json"],
          main.root
        );
        expect(ran.exitCode).toBe(exit);
        if (exit === 2) {
          expect(ran.stdout).toContain("bundler, node16, or nodenext");
        }
      })
    );
  });
});

test("compatibility requires semantic checks on selected declaration files", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    const directory = await packageAt(main.root, "current", "^5.0.0");
    await Bun.write(path.join(directory, "index.d.ts"), BEFORE);
    const ran = await runEntry(
      ROPE,
      ["check", "packages/current/index.d.ts", "--json"],
      main.root
    );
    expect(ran.exitCode).toBe(2);
    expect(ran.stdout).toContain(
      "skipLibCheck disables the required declaration check"
    );
    await Bun.write(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { module: "esnext", moduleResolution: "bundler" },
      })
    );
    const checked = await runEntry(
      ROPE,
      ["check", "packages/current/index.d.ts", "--json"],
      main.root
    );
    expect(checked.exitCode).toBe(1);
    expect(checked.stdout).toContain("typescript-api/removed-map");
  });
});
