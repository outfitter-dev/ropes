import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import {
  rumdlAdapter,
  SUPPORTED_RANGE,
} from "../src/adapters/rumdl/adapter.ts";
import type { Plan } from "../src/contracts/plan.ts";
import { exitCodeOf } from "../src/contracts/result.ts";
import { runPlan } from "../src/runner/run.ts";

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

const planFor = (root: string, adapter = rumdlAdapter()): Plan => ({
  paths: [
    {
      path: "a.md",
      policy: [],
      steps: [
        {
          adapter: adapter.descriptor.id,
          tool: adapter.descriptor.tool,
          versionRange: adapter.descriptor.versionRange,
          writes: adapter.descriptor.writes,
        },
      ],
    },
  ],
  root,
  schemaVersion: 0,
  selection: { kind: "workspace" },
});

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
    rumdlAdapter().check({ path: "a.md", root })
  );
  expect(outcome).toEqual({ findings: [], status: "passed" });
});

withEngine("check reports findings with their positions", async () => {
  const [outcome, after] = await inRepo({ "a.md": MESSY }, async (root) => [
    await rumdlAdapter().check({ path: "a.md", root }),
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
      await rumdlAdapter().fix({ path: "a.md", root }),
      await Bun.file(path.join(root, "a.md")).text(),
    ]);
    expect(outcome).toEqual({ findings: [], status: "fixed" });
    expect(after).toBe("# A\n\n## B\n");
  }
);

withEngine("fix leaves what it cannot fix as findings", async () => {
  const outcome = await inRepo({ "a.md": MESSY }, (root) =>
    rumdlAdapter().fix({ path: "a.md", root })
  );
  expect(outcome.status).toBe("findings");
  expect(outcome.findings.map((finding) => finding.rule)).toEqual(["MD033"]);
});

withEngine("fix on a clean file passes without calling it fixed", async () => {
  const outcome = await inRepo({ "a.md": CLEAN }, (root) =>
    rumdlAdapter().fix({ path: "a.md", root })
  );
  expect(outcome).toEqual({ findings: [], status: "passed" });
});

withEngine("the repository's own rumdl config applies", async () => {
  const files = {
    ".rumdl.toml": '[global]\ndisable = ["MD033"]\n',
    "a.md": "# A\n\n<b>hi</b>\n",
  };
  const outcome = await inRepo(files, (root) =>
    rumdlAdapter().check({ path: "a.md", root })
  );
  expect(outcome).toEqual({ findings: [], status: "passed" });
});

withEngine(
  "a rumdl config that does not parse makes the step incomplete",
  async () => {
    const outcome = await inRepo(
      { ".rumdl.toml": "bad = [", "a.md": CLEAN },
      (root) => rumdlAdapter().check({ path: "a.md", root })
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
