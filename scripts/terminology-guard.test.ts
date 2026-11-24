import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import docs from "./terminology-docs.json" with { type: "json" };

const guard = fileURLToPath(new URL("terminology-guard.ts", import.meta.url));
const repository = fileURLToPath(new URL("../", import.meta.url));
const retired = ["Cin", "ch"].join("");

interface Exception {
  readonly reason: string;
  readonly lines: readonly string[];
}

const git = (cwd: string, ...args: string[]): void => {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
};

const runGuard = (script: string, cwd: string) =>
  Bun.spawnSync([process.execPath, script], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });

const fixture = async (
  exceptions: Readonly<Record<string, Exception>>,
  body: (root: string, scan: () => ReturnType<typeof runGuard>) => Promise<void>
): Promise<void> => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-terminology-"));
  try {
    git(root, "init", "-q");
    const copiedGuard = path.join(root, ".guard/terminology-guard.ts");
    await Bun.write(copiedGuard, await readFile(guard));
    await Bun.write(
      path.join(root, ".guard/terminology-allowlist.ts"),
      'import entries from "./fixture-registry.json" with { type: "json" };\nexport const exceptions = entries;\nexport const registryFiles = [];\n'
    );
    await Bun.write(
      path.join(root, ".guard/fixture-registry.json"),
      JSON.stringify(exceptions)
    );
    await body(root, () => runGuard(copiedGuard, root));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const historical = `# Historical ${retired}`;
const exception = { lines: [historical], reason: "Historical fixture." };

test("the guard checks tracked text and paths with exact historical exceptions", async () => {
  await fixture({ "history.md": exception }, async (root, scan) => {
    await Bun.write(path.join(root, "history.md"), `${historical}\n`);
    await Bun.write(path.join(root, "draft.md"), `${retired}\n`);
    await Bun.write(path.join(root, "current.md"), "# Ropes\n");
    git(root, "add", "--", "history.md", "current.md");
    expect(scan().exitCode).toBe(0);

    const obsoletePath = `${retired.toUpperCase()}.md`;
    await Bun.write(path.join(root, obsoletePath), "# Ropes\n");
    git(root, "add", "--", obsoletePath);
    await Bun.write(
      path.join(root, "current.md"),
      `# ${retired.toLowerCase()}\n`
    );
    await Bun.write(path.join(root, "history.md"), `${historical}\n`.repeat(2));
    const blocked = scan();
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr.toString()).toContain(
      `current.md:1: # ${retired.toLowerCase()}`
    );
    expect(blocked.stderr.toString()).toContain(
      `${obsoletePath} (tracked path)`
    );
    expect(blocked.stderr.toString()).toContain("history.md:2:");
    expect(blocked.stderr.toString()).not.toContain("history.md:1:");
    expect(blocked.stderr.toString()).not.toContain("draft.md");
  });
});

test("Git output preferences cannot add columns headings or context", async () => {
  await fixture({ "history.md": exception }, async (root, scan) => {
    await Bun.write(path.join(root, "history.md"), `${historical}\n`);
    await Bun.write(path.join(root, "current.md"), "# Ropes\n");
    git(root, "add", "--", "history.md", "current.md");
    git(root, "config", "grep.column", "true");
    git(root, "config", "grep.lineNumber", "false");
    git(root, "config", "grep.patternType", "perl");
    git(root, "config", "color.grep", "always");
    expect(scan().exitCode).toBe(0);
    await Bun.write(path.join(root, "current.md"), `# ${retired}\n`);
    const blocked = scan();
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr.toString()).toContain(`current.md:1: # ${retired}`);
    expect(blocked.stderr.toString()).not.toContain("Could not parse");
  });
});

test("removing an occurrence requires retiring its exact allowance", async () => {
  await fixture({ "history.md": exception }, async (root, scan) => {
    await Bun.write(path.join(root, "history.md"), `${historical}\n`);
    git(root, "add", "--", "history.md");
    expect(scan().exitCode).toBe(0);
    await Bun.write(path.join(root, "history.md"), "# Ropes\n");
    const stale = scan();
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr.toString()).toContain(
      `history.md: remove unused historical allowance: ${historical}`
    );
    await Bun.write(path.join(root, ".guard/fixture-registry.json"), "{}");
    expect(scan().exitCode).toBe(0);
  });
});

test.each([
  { entry: docs["docs/cutover.md"], file: "docs/cutover.md" },
  { entry: docs["docs/rollout.md"], file: "docs/rollout.md" },
])(
  "current $file text cannot inherit historical allowances",
  async ({ file, entry }) => {
    await fixture({ [file]: entry }, async (root, scan) => {
      const text = await readFile(path.join(repository, file), "utf-8");
      await Bun.write(path.join(root, file), text);
      git(root, "add", "--", file);
      expect(scan().exitCode).toBe(0);
      await Bun.write(
        path.join(root, file),
        `Run ${retired.toLowerCase()} check for current setup.\n${text}`
      );
      const blocked = scan();
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr.toString()).toContain(
        `${file}:1: Run ${retired.toLowerCase()} check for current setup.`
      );
    });
  }
);

test("the production registry covers exactly the complete tracked repository", () => {
  const result = Bun.spawnSync([process.execPath, guard], { cwd: repository });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
