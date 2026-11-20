import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import {
  rumdlAdapter,
  SUPPORTED_RANGE,
} from "../src/adapters/rumdl/adapter.ts";
import { SCHEMA_VERSION } from "../src/contracts/plan.ts";
import type { Plan } from "../src/contracts/plan.ts";
import { exitCodeOf } from "../src/contracts/result.ts";
import { runPlan } from "../src/runner/run.ts";
import { checkOne, fixOne } from "./one-file.ts";

const MESSY = "# A\n\n# B\n\n<b>hi</b>\n";
const FIXABLE = "# A\n\n# B\n";
const CLEAN = "# A\n\nText.\n";

const installed = Bun.which("rumdl") !== null;
/** A real-engine test. It says so when the engine is not there to run it. */
const withEngine = (name: string, body: () => Promise<void>) => {
  test(name, async () => {
    if (!installed) {
      console.warn(`skipped: rumdl is not on PATH, so "${name}" did not run`);
      return;
    }
    await body();
  });
};

const inRepo = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-rumdl-"));
  try {
    await Promise.all(
      Object.entries(files).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const planFor = (root: string, adapter = rumdlAdapter()): Plan => {
  const step = {
    adapter: adapter.descriptor.id,
    tool: adapter.descriptor.tool,
    versionRange: adapter.descriptor.versionRange,
    writes: adapter.descriptor.writes,
  };
  return {
    batches: [{ ...step, package: ".", paths: ["a.md"] }],
    paths: [{ package: ".", path: "a.md", policy: [], steps: [step] }],
    root,
    schemaVersion: SCHEMA_VERSION,
    selection: { kind: "workspace" },
  };
};

const lint = (pins: Record<string, string>) =>
  adaptersFor(pins).find((adapter) => adapter.descriptor.id === "rumdl");

test("the registry hands the adapter the pinned version", () => {
  const pinned = lint({ rumdl: "0.3.5" });
  const unpinned = lint({});
  expect(pinned?.descriptor.versionRange).toBe("0.3.5");
  expect(unpinned?.descriptor.versionRange).toBe(SUPPORTED_RANGE);
});

test("with the binary missing, the step is incomplete and the run exits 2", async () => {
  const adapter = rumdlAdapter({ command: "cinch-test-no-such-rumdl" });
  const result = await inRepo({ "a.md": CLEAN }, (root) =>
    runPlan(planFor(root, adapter), [adapter], { mode: "check" })
  );
  expect(result.steps).toEqual([
    {
      adapter: "rumdl",
      findings: [],
      path: "a.md",
      reason: "cinch-test-no-such-rumdl is not on PATH",
      status: "incomplete",
    },
  ]);
  expect(exitCodeOf(result)).toBe(2);
});

withEngine("probe reports the installed version as plain semver", async () => {
  const probe = await rumdlAdapter().probe();
  expect(probe.available).toBe(true);
  expect(probe.version).toMatch(/^\d+\.\d+\.\d+$/u);
});

withEngine("check passes a clean file and writes nothing", async () => {
  const outcome = await inRepo({ "a.md": CLEAN }, (root) =>
    checkOne(rumdlAdapter(), { path: "a.md", root })
  );
  expect(outcome).toEqual({ findings: [], status: "passed" });
});

withEngine("check reports findings with their positions", async () => {
  const [outcome, after] = await inRepo({ "a.md": MESSY }, async (root) => [
    await checkOne(rumdlAdapter(), { path: "a.md", root }),
    await Bun.file(path.join(root, "a.md")).text(),
  ]);
  expect(after).toBe(MESSY);
  expect(outcome.status).toBe("findings");
  expect(outcome.findings).toContainEqual({
    fixable: false,
    message: "Inline HTML found: <b>",
    path: "a.md",
    range: { start: { column: 1, line: 5 } },
    rule: "MD033",
    severity: "warning",
    source: "rumdl",
  });
});

withEngine(
  "fix rewrites what it can and reports the file as fixed",
  async () => {
    const [outcome, after] = await inRepo({ "a.md": FIXABLE }, async (root) => [
      await fixOne(rumdlAdapter(), { path: "a.md", root }),
      await Bun.file(path.join(root, "a.md")).text(),
    ]);
    expect(outcome).toEqual({ findings: [], status: "fixed" });
    expect(after).toBe("# A\n\n## B\n");
  }
);

withEngine("fix leaves what it cannot fix as findings", async () => {
  const outcome = await inRepo({ "a.md": MESSY }, (root) =>
    fixOne(rumdlAdapter(), { path: "a.md", root })
  );
  expect(outcome.status).toBe("findings");
  expect(outcome.findings.map((finding) => finding.rule)).toEqual(["MD033"]);
});

withEngine("fix on a clean file passes without calling it fixed", async () => {
  const outcome = await inRepo({ "a.md": CLEAN }, (root) =>
    fixOne(rumdlAdapter(), { path: "a.md", root })
  );
  expect(outcome).toEqual({ findings: [], status: "passed" });
});

withEngine("the repository's own rumdl config applies", async () => {
  const files = {
    ".rumdl.toml": '[global]\ndisable = ["MD033"]\n',
    "a.md": "# A\n\n<b>hi</b>\n",
  };
  const outcome = await inRepo(files, (root) =>
    checkOne(rumdlAdapter(), { path: "a.md", root })
  );
  expect(outcome).toEqual({ findings: [], status: "passed" });
});

withEngine(
  "a rumdl config that does not parse makes the step incomplete",
  async () => {
    const outcome = await inRepo(
      { ".rumdl.toml": "bad = [", "a.md": CLEAN },
      (root) => checkOne(rumdlAdapter(), { path: "a.md", root })
    );
    expect(outcome.status).toBe("incomplete");
    expect(outcome.reason).toStartWith("rumdl exited 2: ");
  }
);

withEngine("a run through the runner exits 1 on findings", async () => {
  const adapter = rumdlAdapter();
  const result = await inRepo({ "a.md": MESSY }, (root) =>
    runPlan(planFor(root, adapter), [adapter], { mode: "check" })
  );
  expect(exitCodeOf(result)).toBe(1);
});

const together = (root: string, paths: readonly string[]) =>
  rumdlAdapter().check({ package: ".", paths, root });

withEngine("one start answers for every file of the batch", async () => {
  const files = { "a.md": CLEAN, "b.md": "# B\n\n#bad\n", "sub/c.md": CLEAN };
  const outcomes = await inRepo(files, (root) =>
    together(root, ["a.md", "b.md", "sub/c.md"])
  );
  expect(outcomes.map((outcome) => [outcome.path, outcome.status])).toEqual([
    ["a.md", "passed"],
    ["b.md", "findings"],
    ["sub/c.md", "passed"],
  ]);
  expect(outcomes[1]?.findings.map((finding) => finding.path)).toEqual([
    "b.md",
  ]);
});

withEngine(
  "a file the engine's own config excludes is still checked",
  async () => {
    const files = {
      ".rumdl.toml": 'exclude = ["b.md"]\n',
      "a.md": CLEAN,
      "b.md": "# B\n\n#bad\n",
    };
    const outcomes = await inRepo(files, (root) =>
      together(root, ["a.md", "b.md"])
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "passed",
      "findings",
    ]);
  }
);

withEngine(
  "one file the engine cannot read does not take the batch",
  async () => {
    const outcomes = await inRepo({ "a.md": CLEAN }, (root) =>
      together(root, ["a.md", "gone.md"])
    );
    expect(outcomes.map((outcome) => [outcome.path, outcome.status])).toEqual([
      ["a.md", "passed"],
      ["gone.md", "incomplete"],
    ]);
  }
);

withEngine("fix says which files of the batch it changed", async () => {
  const files = { "a.md": CLEAN, "b.md": "# B\n\n#bad\n" };
  const outcomes = await inRepo(files, (root) =>
    rumdlAdapter().fix({ package: ".", paths: ["a.md", "b.md"], root })
  );
  expect(outcomes.map((outcome) => [outcome.path, outcome.status])).toEqual([
    ["a.md", "passed"],
    ["b.md", "fixed"],
  ]);
});
