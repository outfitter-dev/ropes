import { expect, test } from "bun:test";
import { realpath, symlink } from "node:fs/promises";
import path from "node:path";

import { apiPreviewInputs } from "../../core/src/adapters/bun-check/api-package.ts";
import { CopyError, withCopy } from "../../core/src/commands/scratch.ts";
import { FixReportSchema } from "../../core/src/contracts/fix.ts";
import {
  json,
  runEntry,
  withFixture,
} from "../../core/tests/acceptance-repo.ts";
import {
  apiPackage,
  BEFORE,
  CONFIG,
  packageAt,
  RULE,
} from "./compatibility-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("fix previews preserve the exact ignored nested TypeScript installation", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(path.join(main.root, ".gitignore"), "**/node_modules/\n");
    const directory = await packageAt(main.root, "current", "^5.0.0");
    const nested = path.join(directory, "nested");
    await apiPackage(nested, "5-0");
    const source = path.join(nested, "index.ts");
    await Bun.write(source, BEFORE);
    const args = ["fix", "packages/current/nested/index.ts", "--json"];
    const regular = await runEntry(ROPE, args, main.root);
    const preview = await runEntry(ROPE, [...args, "--dry-run"], main.root);
    expect(regular.exitCode).toBe(1);
    expect(preview.exitCode).toBe(regular.exitCode);
    const actual = FixReportSchema.parse(json(regular));
    const proposed = FixReportSchema.parse(json(preview));
    expect({ ...proposed, dryRun: false }).toEqual(actual);
    expect(proposed.result.steps[0]?.findings[0]).toMatchObject({
      nativeRule: "TS2305",
      rule: RULE,
      source: "typescript-api",
    });
    await Bun.write(source, "export {};\n");
    const clean = await runEntry(ROPE, [...args, "--dry-run"], main.root);
    expect(clean.exitCode).toBe(0);
    await apiPackage(nested, "4-9");
    const wrong = await runEntry(ROPE, [...args, "--dry-run"], main.root);
    expect(wrong.exitCode).toBe(2);
    expect(wrong.stdout).toContain("4.9.5 does not satisfy");
  });
});

test("dependency snapshots are independent copies and reject checkout aliases", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, ".gitignore"), "**/node_modules/\n");
    const directory = await packageAt(main.root, "current", "^5.0.0");
    await Bun.write(path.join(directory, "index.ts"), BEFORE);
    const inputs = await apiPreviewInputs({
      package: "packages/current",
      paths: ["packages/current/index.ts"],
      root: main.root,
    });
    expect(inputs).toHaveLength(1);
    const original = path.join(
      directory,
      "node_modules/typescript/package.json"
    );
    const before = await Bun.file(original).text();
    const outside = path.join(main.root, "outside.txt");
    await Bun.write(outside, "original\n");
    await symlink(
      outside,
      path.join(directory, "node_modules/typescript/linked.txt")
    );
    await withCopy(
      { root: main.root, vcsRoot: main.root },
      [],
      async (copy) => {
        const copied = path.join(
          copy,
          "packages/current/node_modules/typescript"
        );
        const copiedDirectory = await realpath(copied);
        expect(copiedDirectory.startsWith(`${copy}/`)).toBe(true);
        await Bun.write(path.join(copied, "package.json"), "{}\n");
        const linkedFile = await realpath(path.join(copied, "linked.txt"));
        expect(linkedFile.startsWith(`${copy}/`)).toBe(true);
        await Bun.write(
          path.join(copied, "linked.txt"),
          "changed in preview\n"
        );
      },
      inputs
    );
    expect(await Bun.file(original).text()).toBe(before);
    expect(await Bun.file(outside).text()).toBe("original\n");
    await apiPackage(main.root, "5-0");
    const rootInput = {
      path: "node_modules/typescript",
      source: path.dirname(original),
    };
    const rejected = await withCopy(
      { root: main.root, vcsRoot: main.root },
      [],
      (copy) => Bun.file(path.join(copy, "outside.txt")).text(),
      [rootInput]
    ).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(CopyError);
    expect(await Bun.file(original).text()).toBe(before);
  });
});
