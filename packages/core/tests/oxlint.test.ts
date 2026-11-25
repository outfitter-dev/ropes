import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { whichLocal } from "../src/adapters/local.ts";
import {
  oxlintAdapter,
  SUPPORTED_RANGE,
} from "../src/adapters/oxlint/adapter.ts";
import { adaptersFor } from "../src/adapters/registry.ts";
import { createCommands } from "../src/commands/registry.ts";
import { PlanSchema } from "../src/contracts/plan.ts";
import type { PlannedPath } from "../src/contracts/plan.ts";
import { checkOne, fixOne } from "./one-file.ts";

const installed = whichLocal("oxlint") !== null;
/** A real-engine test. It says so when the engine is not there to run it. */
const withEngine = (name: string, body: () => Promise<void>) => {
  test(name, async () => {
    if (!installed) {
      console.warn(
        `skipped: oxlint is not installed, so "${name}" did not run`
      );
      return;
    }
    await body();
  });
};

/** A config with two core rules and nothing that needs another package. */
const CONFIG = JSON.stringify({
  rules: { eqeqeq: "error", "no-var": "error" },
});

const inRepo = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-oxlint-"));
  try {
    await Promise.all(
      Object.entries({ ".oxlintrc.json": CONFIG, ...files }).map(
        ([name, text]) => Bun.write(path.join(root, name), text)
      )
    );
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

/** A stand-in executable that prints `stdout` and exits with `code`. */
const fake = async (root: string, stdout: string, code: number) => {
  const file = path.join(root, "fake-lint");
  await Bun.write(
    file,
    `#!/bin/sh\ncat <<'REPORT'\n${stdout}\nREPORT\nexit ${code}\n`
  );
  await chmod(file, 0o755);
  return file;
};

test("the adapter is off until asked for, writes, and follows a pin", () => {
  expect(oxlintAdapter().descriptor).toMatchObject({
    enabledBy: "lint.enabled",
    optIn: true,
    unit: "file",
    versionRange: SUPPORTED_RANGE,
    writes: true,
  });
  expect(oxlintAdapter().descriptor.extensions).toContain(".ts");
  const pinned = adaptersFor({ oxlint: "1.93.0" }).find(
    (adapter) => adapter.descriptor.id === "oxlint"
  );
  expect(pinned?.descriptor.versionRange).toBe("1.93.0");
});

test("a command that is nowhere is not available", async () => {
  const probe = await oxlintAdapter({ command: "ropes-no-such-lint" }).probe();
  expect(probe.available).toBe(false);
});

withEngine("the probe reads the installed version", async () => {
  const probe = await oxlintAdapter().probe();
  expect(probe).toMatchObject({ available: true });
  expect(probe.version).toMatch(/^\d+\.\d+\.\d+$/u);
});

withEngine("a clean file passes and a bad one reports its rules", async () => {
  await inRepo(
    {
      "a.ts": "export const a = 1;\n",
      "b.ts": "var b = 1 == 2;\nexport { b };\n",
    },
    async (root) => {
      const outcomes = await oxlintAdapter().check({
        package: ".",
        paths: ["a.ts", "b.ts"],
        root,
      });
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "passed",
        "findings",
      ]);
      expect(outcomes[1]?.findings.map((finding) => finding.rule)).toEqual([
        "eslint(no-var)",
        "eslint(eqeqeq)",
      ]);
    }
  );
});

withEngine(
  "fix writes what the linter can fix and reports what is left",
  async () => {
    await inRepo({ "a.ts": "var a = 1;\nexport { a };\n" }, async (root) => {
      const first = await fixOne(oxlintAdapter(), { path: "a.ts", root });
      expect(first).toEqual({ findings: [], status: "fixed" });
      expect(await Bun.file(path.join(root, "a.ts")).text()).toBe(
        "const a = 1;\nexport { a };\n"
      );
      const second = await fixOne(oxlintAdapter(), { path: "a.ts", root });
      expect(second).toEqual({ findings: [], status: "passed" });
    });
  }
);

withEngine("a file that does not parse is a finding, not a pass", async () => {
  await inRepo({ "a.ts": "export const a = (;\n" }, async (root) => {
    const outcome = await checkOne(oxlintAdapter(), { path: "a.ts", root });
    expect(outcome.status).toBe("findings");
    expect(outcome.findings[0]?.rule).toBe("syntax");
  });
});

test("a file that is not there yet is left to the adapter that keeps it", async () => {
  await inRepo({}, async (root) => {
    const outcome = await checkOne(
      oxlintAdapter({ command: "ropes-no-such-lint" }),
      { path: "kept.ts", root }
    );
    expect(outcome).toEqual({ findings: [], status: "passed" });
  });
});

test("a run that linted fewer files than it was given passes none of them", async () => {
  await inRepo({ "a.ts": "", "b.ts": "" }, async (root) => {
    const command = await fake(
      root,
      JSON.stringify({ diagnostics: [], number_of_files: 1 }),
      0
    );
    const outcomes = await oxlintAdapter({ command }).check({
      package: ".",
      paths: ["a.ts", "b.ts"],
      root,
    });
    // Each file is then run by itself, and the stand-in still says one.
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "passed",
      "passed",
    ]);
    const none = await fake(
      root,
      JSON.stringify({ diagnostics: [], number_of_files: 0 }),
      0
    );
    const outcome = await checkOne(oxlintAdapter({ command: none }), {
      path: "a.ts",
      root,
    });
    expect(outcome).toMatchObject({
      reason: "oxlint linted 0 of the 1 files it was given",
      status: "incomplete",
    });
  });
});

test("an exit code that is not 0 or 1, or a report that cannot be read, is incomplete", async () => {
  await inRepo({ "a.ts": "" }, async (root) => {
    const crashed = await fake(root, "", 2);
    expect(
      await checkOne(oxlintAdapter({ command: crashed }), {
        path: "a.ts",
        root,
      })
    ).toMatchObject({ status: "incomplete" });
    const garbled = await fake(root, "Failed to parse config", 1);
    expect(
      await checkOne(oxlintAdapter({ command: garbled }), {
        path: "a.ts",
        root,
      })
    ).toMatchObject({
      reason:
        "oxlint ran, but oxlint printed a report Ropes cannot read: Failed to parse config",
      status: "incomplete",
    });
    const silent = await fake(
      root,
      JSON.stringify({ diagnostics: [], number_of_files: 1 }),
      1
    );
    expect(
      await checkOne(oxlintAdapter({ command: silent }), { path: "a.ts", root })
    ).toMatchObject({
      reason: "oxlint exited 1 without reporting a finding",
      status: "incomplete",
    });
  });
});

test("a TypeScript file gets a lint step only when the config switches lint on", async () => {
  const { explain } = createCommands({ adapters: adaptersFor });
  const stepsWith = (config: string) =>
    inRepo(
      { "a.ts": "", "rope.toml": `pilot = 0\n${config}` },
      async (root) => {
        await mkdir(path.join(root, ".git"));
        const ran = await explain?.({ cwd: root, json: true, paths: ["a.ts"] });
        const plan = PlanSchema.parse(JSON.parse(ran?.output ?? "null"));
        return plan.paths.flatMap((entry) =>
          entry.steps.map((step) => step.adapter)
        );
      }
    );
  const include = 'include = ["**/*.ts"]\n';
  expect(await stepsWith(include)).toEqual([]);
  expect(await stepsWith(`${include}[lint]\nenabled = true\n`)).toEqual([
    "oxlint",
  ]);
  expect(
    await stepsWith(
      `${include}[lint]\nenabled = true\n[[overrides]]\npaths = ["a.ts"]\nlint.enabled = false\n`
    )
  ).toEqual([]);
});

/**
 * A stand-in that cannot take `bad.ts`. A fixing run reports an error in
 * the first file it is given, as the engine reports what it saw before it
 * wrote, and a checking run reports none.
 */
const PICKY = `#!/bin/sh
fix=0; n=0; first=""; files=0
for arg in "$@"; do
  if [ "$files" = 1 ]; then
    n=$((n + 1))
    if [ -z "$first" ]; then first="$arg"; fi
    if [ "$arg" = "bad.ts" ]; then exit 2; fi
  fi
  if [ "$arg" = "--fix" ]; then fix=1; fi
  if [ "$arg" = "--" ]; then files=1; fi
done
if [ "$fix" = 1 ]; then
  printf '{"diagnostics":[{"code":"x","filename":"%s","message":"m","severity":"error"}],"number_of_files":%s}\n' "$first" "$n"
  exit 1
fi
printf '{"diagnostics":[],"number_of_files":%s}\n' "$n"
`;

test("a fix checks again every file it could take, when another start could not run", async () => {
  const good = Array.from(
    { length: 200 },
    (_, index) => `f${String(index).padStart(3, "0")}.ts`
  );
  const paths = [...good, "bad.ts"];
  await inRepo(
    Object.fromEntries(paths.map((file) => [file, ""])),
    async (root) => {
      const command = path.join(root, "picky-lint");
      await Bun.write(command, PICKY);
      await chmod(command, 0o755);
      const outcomes = await oxlintAdapter({ command }).fix({
        package: ".",
        paths,
        root,
      });
      expect(outcomes.map((outcome) => outcome.path)).toEqual(paths);
      // The first start fixed its files, so none keeps what was seen before.
      expect(outcomes[0]).toMatchObject({ findings: [], status: "passed" });
      expect(outcomes.at(-1)).toMatchObject({ status: "incomplete" });
    }
  );
});

test("the probe asks the repository the run is for, before the place Ropes runs in", async () => {
  await inRepo({}, async (root) => {
    const bin = path.join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    const command = path.join(bin, "ropes-only-here");
    await Bun.write(command, "#!/bin/sh\necho 'Version: 9.8.7'\n");
    await chmod(command, 0o755);
    const adapter = oxlintAdapter({ command: "ropes-only-here" });
    const elsewhere = await adapter.probe();
    expect(elsewhere.available).toBe(false);
    expect(await adapter.probe(root)).toEqual({
      available: true,
      version: "9.8.7",
    });
  });
});

test("a kept preset gets a lint step that only reads", async () => {
  const { explain } = createCommands({ adapters: adaptersFor });
  const config =
    'pilot = 0\ninclude = ["**/*.ts"]\n[lint]\nenabled = true\npreset = true\n';
  await inRepo({ "a.ts": "", "rope.toml": config }, async (root) => {
    await mkdir(path.join(root, ".git"));
    const ran = await explain?.({ cwd: root, json: true, paths: [] });
    const plan = PlanSchema.parse(JSON.parse(ran?.output ?? "null"));
    const lint = (pick: (entry: PlannedPath) => boolean) =>
      plan.paths
        .filter(pick)
        .flatMap((entry) => entry.steps)
        .filter((step) => step.adapter === "oxlint")
        .map((step) => step.writes);
    expect(lint((entry) => entry.layer === "preset")).toEqual([false]);
    expect(lint((entry) => entry.path === "a.ts")).toEqual([true]);
  });
});

withEngine(
  "a run that fails on warnings alone reports them as findings",
  async () => {
    const strict = JSON.stringify({
      options: { denyWarnings: true },
      rules: { "no-var": "warn" },
    });
    await inRepo(
      { ".oxlintrc.json": strict, "a.ts": "var a = 1;\nexport { a };\n" },
      async (root) => {
        const outcome = await checkOne(oxlintAdapter(), { path: "a.ts", root });
        expect(outcome.status).toBe("findings");
        expect(outcome.findings.map((finding) => finding.severity)).toEqual([
          "warning",
        ]);
      }
    );
  }
);
