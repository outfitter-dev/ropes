import { expect, test } from "bun:test";
import path from "node:path";

import {
  fixtureGit,
  runEntry,
  withFixture,
} from "../../core/tests/acceptance-repo.ts";
import { save } from "./cleanup-stack-fixture.ts";
import { apiPackage, BEFORE, packageAt } from "./compatibility-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const CONFIG = `pilot = 0
include = ["packages/api/**/*.ts"]
exclude = ["**/node_modules/**"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[typescript]
enabled = true
preset = false
`;

test("compatibility cleanup passes on the old API before the final dependency upgrade", async () => {
  if (Bun.which("bun") === null) {
    console.warn(
      "skipped: bun is not on PATH, so the compatibility stack proof did not run"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(
      path.join(main.root, "mise.toml"),
      '[tools]\nbun = "1.4.4"\n'
    );
    await Bun.write(path.join(main.root, ".gitignore"), "**/node_modules/\n");
    const directory = await packageAt(main.root, "api", "^4.9.0", "4-9");
    await Bun.write(path.join(directory, "index.ts"), BEFORE);
    const old = await save(main.root, "old API with the legacy import");
    const check = () =>
      runEntry(
        ROPE,
        ["check", "packages/api/index.ts", "--strict", "--json"],
        main.root
      );
    const initial = await check();
    expect(initial.exitCode).toBe(0);
    await Bun.write(
      path.join(directory, "index.ts"),
      "export type Current = Map<string, string>;\n"
    );
    const bridge = await save(
      main.root,
      "prepare a source form supported by both APIs"
    );
    expect(bridge).not.toBe(old);
    const prepared = await check();
    expect(prepared.exitCode).toBe(0);
    await apiPackage(directory, "5-0");
    await Bun.write(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "api",
        peerDependencies: { typescript: "^5.0.0" },
      })
    );
    await save(main.root, "upgrade the API after compatible source has landed");
    const upgraded = await check();
    expect(upgraded.exitCode).toBe(0);
    await Bun.write(path.join(directory, "index.ts"), BEFORE);
    const incompatible = await save(
      main.root,
      "show the unsupported atomic upgrade"
    );
    const broken = await check();
    expect(broken.exitCode).toBe(1);
    expect(broken.stdout).toContain("TS2305");
    await fixtureGit(main.root, "switch", "--detach", "--quiet", bridge);
    await apiPackage(directory, "4-9");
    const recovered = await check();
    expect(recovered.exitCode).toBe(0);
    expect(incompatible).not.toBe(bridge);
  });
});
