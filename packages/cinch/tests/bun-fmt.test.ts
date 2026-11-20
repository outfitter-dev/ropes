import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  bunFmtAdapter,
  SUPPORTED_RANGE,
} from "../src/adapters/bun-fmt/adapter.ts";
import { parseOutput, writeFailures } from "../src/adapters/bun-fmt/output.ts";
import { adaptersFor } from "../src/adapters/registry.ts";
import type { Finding } from "../src/contracts/finding.ts";
import { checkOne, fixOne } from "./one-file.ts";

const inRepo = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-fmt-"));
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

const onPath = Bun.which("bun") !== null;
/** A real-engine test. It says so when the engine is not there to run it. */
const withEngine = (name: string, body: () => Promise<void>) => {
  test(name, async () => {
    if (!onPath) {
      console.warn(`skipped: bun is not on PATH, so "${name}" did not run`);
      return;
    }
    await body();
  });
};

const unformatted = (file: string): Finding => ({
  fixable: true,
  message: "The file is not formatted. `cinch fix` formats it.",
  path: file,
  range: { start: { column: 1, line: 1 } },
  rule: "format",
  severity: "error",
  source: "bun-fmt",
});

test("the adapter is off until asked for, writes, and follows the pin", () => {
  expect(bunFmtAdapter().descriptor).toMatchObject({
    enabledBy: "format.enabled",
    optIn: true,
    tool: "bun",
    versionRange: SUPPORTED_RANGE,
    writes: true,
  });
  const adapters = adaptersFor({ bun: "1.4.4" });
  expect(adapters.at(-1)?.descriptor).toMatchObject({
    id: "bun-fmt",
    versionRange: "1.4.4",
  });
});

test("a command that is not on PATH is not available, and its steps are incomplete", async () => {
  const adapter = bunFmtAdapter({ command: "cinch-no-such-bun" });
  const probe = await adapter.probe();
  expect(probe.available).toBe(false);
  await inRepo({ "a.ts": "" }, async (root) => {
    expect(await checkOne(adapter, { path: "a.ts", root })).toMatchObject({
      status: "incomplete",
    });
  });
});

withEngine("the probe reads the version of the Bun on PATH", async () => {
  const probe = await bunFmtAdapter().probe();
  expect(probe).toMatchObject({ available: true });
  expect(probe.version).toMatch(/^\d+\.\d+\.\d+$/u);
});

withEngine(
  "a formatted file passes and one that is not is a fixable finding",
  async () => {
    await inRepo(
      { "a.ts": "export const a = 1;\n", "b.ts": "export const b  =  1\n" },
      async (root) => {
        const outcomes = await bunFmtAdapter().check({
          package: ".",
          paths: ["a.ts", "b.ts"],
          root,
        });
        expect(outcomes).toEqual([
          { findings: [], path: "a.ts", status: "passed" },
          {
            findings: [unformatted("b.ts")],
            path: "b.ts",
            status: "findings",
          },
        ]);
      }
    );
  }
);

withEngine(
  "fix formats the file, and a second run changes nothing",
  async () => {
    await inRepo({ "a.ts": "export const a  =  1\n" }, async (root) => {
      const adapter = bunFmtAdapter();
      expect(await fixOne(adapter, { path: "a.ts", root })).toEqual({
        findings: [],
        status: "fixed",
      });
      expect(await Bun.file(path.join(root, "a.ts")).text()).toBe(
        "export const a = 1;\n"
      );
      expect(await fixOne(adapter, { path: "a.ts", root })).toEqual({
        findings: [],
        status: "passed",
      });
    });
  }
);

withEngine(
  "a file that does not parse is a finding, and the others are still judged",
  async () => {
    await inRepo(
      { "a.ts": "export const a = (;\n", "b.ts": "export const b  =  1\n" },
      async (root) => {
        const outcomes = await bunFmtAdapter().fix({
          package: ".",
          paths: ["a.ts", "b.ts"],
          root,
        });
        expect(outcomes[0]).toMatchObject({
          findings: [
            {
              fixable: false,
              range: { start: { column: 19, line: 1 } },
              rule: "syntax",
            },
          ],
          status: "findings",
        });
        expect(outcomes[1]).toMatchObject({ findings: [], status: "fixed" });
      }
    );
  }
);

withEngine(
  "a file the formatter leaves out is incomplete, never passed",
  async () => {
    await inRepo(
      { ".gitignore": "out/\n", "out/a.ts": "export const a  =  1\n" },
      async (root) => {
        const outcome = await checkOne(bunFmtAdapter(), {
          path: "out/a.ts",
          root,
        });
        expect(outcome).toMatchObject({ status: "incomplete" });
        expect(outcome.reason).toContain("leaves it out");
      }
    );
  }
);

withEngine(
  "a file that is not there yet is left to the adapter that keeps it",
  async () => {
    await inRepo({}, async (root) => {
      expect(
        await checkOne(bunFmtAdapter(), { path: "kept.ts", root })
      ).toEqual({
        findings: [],
        status: "passed",
      });
    });
  }
);

test("the output of a run is read into findings for the files it was given", () => {
  const context = { paths: ["a.ts", "b.json"], source: "bun-fmt" };
  const parsed = parseOutput(
    {
      stderr:
        "error: Unexpected end of file\n    at b.json:2:1\n\nError occurred when checking code style in the above files.\n",
      stdout: "a.ts\n",
    },
    context
  );
  expect(parsed.ok ? parsed.files.get("a.ts") : []).toEqual([
    unformatted("a.ts"),
  ]);
  expect(parsed.ok ? parsed.files.get("b.json") : []).toMatchObject([
    {
      message: "Unexpected end of file",
      range: { start: { column: 1, line: 2 } },
      rule: "syntax",
    },
  ]);
  expect(parseOutput({ stderr: "", stdout: "other.ts\n" }, context)).toEqual({
    message: "it named other.ts, which it was not given",
    ok: false,
  });
});

withEngine(
  "a file whose name starts with ! is formatted, and no other file is",
  async () => {
    await inRepo(
      {
        "!a.ts": "export const a  =  1\n",
        "b.ts": "export const b  =  1\n",
        "oxfmt.config.ts": "export default {};\n",
      },
      async (root) => {
        const adapter = bunFmtAdapter();
        expect(await fixOne(adapter, { path: "!a.ts", root })).toEqual({
          findings: [],
          status: "fixed",
        });
        expect(await Bun.file(path.join(root, "b.ts")).text()).toBe(
          "export const b  =  1\n"
        );
      }
    );
  }
);

withEngine(
  "a file whose name starts with a space is judged like any other",
  async () => {
    await inRepo({ " a.ts": "export const a  =  1\n" }, async (root) => {
      expect(await checkOne(bunFmtAdapter(), { path: " a.ts", root })).toEqual({
        findings: [unformatted(" a.ts")],
        status: "findings",
      });
    });
  }
);

withEngine(
  "a file the formatter passes over with a warning is a finding, not a pass",
  async () => {
    await inRepo(
      { "a.toml": "value = [\n", "oxfmt.config.ts": "export default {};\n" },
      async (root) => {
        const outcome = await checkOne(bunFmtAdapter(), {
          path: "a.toml",
          root,
        });
        expect(outcome).toMatchObject({
          findings: [{ fixable: false, rule: "syntax" }],
          status: "findings",
        });
      }
    );
  }
);

withEngine(
  "a file the formatter cannot write is incomplete, with the reason",
  async () => {
    if (process.getuid?.() === 0) {
      console.warn("skipped: root can write any file, so no write fails");
      return;
    }
    await inRepo({ "a.ts": "export const a  =  1\n" }, async (root) => {
      await chmod(path.join(root, "a.ts"), 0o444);
      const outcome = await fixOne(bunFmtAdapter(), { path: "a.ts", root });
      expect(outcome).toMatchObject({ findings: [], status: "incomplete" });
      expect(outcome.reason).toContain("could not write this file");
    });
  }
);

test("the files a writing run could not write are read with their reasons", () => {
  const stderr = [
    "error: Unexpected token",
    "    at bad.ts:2:1",
    "",
    'error: Unable to write file "sub/a.ts":',
    "EACCES: Permission denied",
    "Error occurred when checking code style in the above files.",
  ].join("\n");
  expect([...writeFailures(stderr)]).toEqual([
    ["sub/a.ts", "EACCES: Permission denied"],
  ]);
  expect([...writeFailures("")]).toEqual([]);
});
