import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("terminology-guard.ts", import.meta.url));
const retired = ["Cin", "ch"].join("");

const git = (cwd: string, ...args: string[]): void => {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
};

const scan = (cwd: string) => Bun.spawnSync([process.execPath, guard], { cwd });

test("the guard checks tracked text and paths, with explicit historical exceptions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-terminology-"));
  try {
    git(root, "init", "-q");
    await Bun.write(
      path.join(root, "docs/cutover.md"),
      `# Historical ${retired}\n`
    );
    await Bun.write(path.join(root, "draft.md"), `${retired}\n`);
    await Bun.write(path.join(root, "current.md"), "# Ropes\n");
    const checkedScript = "scripts/terminology-guard.ts";
    const known = `const retired = "${retired.toLowerCase()}";\n`;
    await Bun.write(path.join(root, checkedScript), known);
    git(root, "add", "--", "docs/cutover.md", "current.md", checkedScript);
    expect(scan(root).exitCode).toBe(0);

    const obsoletePath = `${retired.toUpperCase()}.md`;
    await Bun.write(path.join(root, obsoletePath), "# Ropes\n");
    git(root, "add", "--", obsoletePath);
    await Bun.write(
      path.join(root, "current.md"),
      `# ${retired.toLowerCase()}\n`
    );
    await Bun.write(path.join(root, checkedScript), known.repeat(2));
    const blocked = scan(root);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr.toString()).toContain(
      `current.md:1: # ${retired.toLowerCase()}`
    );
    expect(blocked.stderr.toString()).toContain(
      `${obsoletePath} (tracked path)`
    );
    expect(blocked.stderr.toString()).toContain(`${checkedScript}:2:`);
    expect(blocked.stderr.toString()).not.toContain(`${checkedScript}:1:`);
    expect(blocked.stderr.toString()).not.toContain("draft.md");
    expect(blocked.stderr.toString()).not.toContain("docs/cutover.md");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
