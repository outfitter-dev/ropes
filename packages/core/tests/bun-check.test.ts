import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  bunCheckAdapter,
  SUPPORTED_RANGE,
} from "../src/adapters/bun-check/adapter.ts";
import { adaptersFor } from "../src/adapters/registry.ts";
import { checkOne, fixOne } from "./one-file.ts";

const STRICT = JSON.stringify({
  compilerOptions: {
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
  },
});

const inRepo = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-types-"));
  try {
    await Promise.all(
      Object.entries({ "tsconfig.json": STRICT, ...files }).map(
        ([name, text]) => Bun.write(path.join(root, name), text)
      )
    );
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const check = (root: string, paths: readonly string[]) =>
  bunCheckAdapter().check({ package: ".", paths, root });

const WRONG = 'export const a: number = "one";\n';

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

test("the adapter is off until asked for, never writes, and follows the pin", () => {
  expect(bunCheckAdapter().descriptor).toMatchObject({
    enabledBy: "typescript.enabled",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    optIn: true,
    tool: "bun",
    versionRange: SUPPORTED_RANGE,
    writes: false,
  });
  const ids = adaptersFor({ bun: "1.4.4" }).map(
    ({ descriptor }) => descriptor.id
  );
  expect(ids.slice(-3)).toEqual(["bun-check", "ast-grep", "bun-fmt"]);
});

test("a command that is not on PATH is not available, and its steps are incomplete", async () => {
  const adapter = bunCheckAdapter({ command: "ropes-no-such-bun" });
  const probe = await adapter.probe();
  expect(probe.available).toBe(false);
  await inRepo({ "a.ts": "" }, async (root) => {
    expect(await checkOne(adapter, { path: "a.ts", root })).toMatchObject({
      status: "incomplete",
    });
  });
});

withEngine(
  "a type error is a finding under the compiler's own code, and fix only checks",
  async () => {
    await inRepo(
      { "a.ts": WRONG, "b.ts": "export const b = 1;\n" },
      async (root) => {
        const outcomes = await check(root, ["a.ts", "b.ts"]);
        expect(outcomes).toEqual([
          {
            findings: [
              {
                fixable: false,
                message: "Type 'string' is not assignable to type 'number'.",
                path: "a.ts",
                range: { start: { column: 14, line: 1 } },
                rule: "TS2322",
                severity: "error",
                source: "bun-check",
              },
            ],
            path: "a.ts",
            status: "findings",
          },
          { findings: [], path: "b.ts", status: "passed" },
        ]);
        const fixed = await fixOne(bunCheckAdapter(), { path: "a.ts", root });
        expect(fixed.status).toBe("findings");
        expect(await Bun.file(path.join(root, "a.ts")).text()).toBe(WRONG);
      }
    );
  }
);

withEngine(
  "each file is held to the nearest compiler config above it",
  async () => {
    const loose = JSON.stringify({
      compilerOptions: { noEmit: true, strict: false },
    });
    const implicit = "export const f = (x) => x;\n";
    await inRepo(
      { "a.ts": implicit, "pkg/a.ts": implicit, "pkg/tsconfig.json": loose },
      async (root) => {
        const [strict, relaxed] = await check(root, ["a.ts", "pkg/a.ts"]);
        expect(strict?.findings.map((finding) => finding.rule)).toEqual([
          "TS7006",
        ]);
        expect(relaxed).toMatchObject({ findings: [], status: "passed" });
      }
    );
  }
);

withEngine(
  "an error in an imported file is left to the run that is given that file",
  async () => {
    await inRepo(
      { "a.ts": 'export { a } from "./b.ts";\n', "b.ts": WRONG },
      async (root) => {
        expect(
          await checkOne(bunCheckAdapter(), { path: "a.ts", root })
        ).toEqual({ findings: [], status: "passed" });
      }
    );
  }
);

withEngine(
  "a file that does not parse has its finding, and the others are still checked",
  async () => {
    await inRepo(
      {
        "a.ts": "export const a = (;\n",
        "b.ts": WRONG,
        "c.ts": "export const c = 1;\n",
      },
      async (root) => {
        const outcomes = await check(root, ["a.ts", "b.ts", "c.ts"]);
        expect(
          outcomes.map((outcome) => [
            outcome.status,
            outcome.findings.map((finding) => finding.rule),
          ])
        ).toEqual([
          ["findings", ["TS1109"]],
          ["findings", ["TS2322"]],
          ["passed", []],
        ]);
      }
    );
  }
);

withEngine(
  "a file whose import does not parse is incomplete, never passed",
  async () => {
    await inRepo(
      {
        "a.ts": 'export { b } from "./b.ts";\n',
        "b.ts": "export const b = (;\n",
      },
      async (root) => {
        const outcome = await checkOne(bunCheckAdapter(), {
          path: "a.ts",
          root,
        });
        expect(outcome.status).toBe("incomplete");
        expect(outcome.reason).toContain("does not parse");
      }
    );
  }
);

withEngine(
  "a compiler config with an error leaves every file incomplete",
  async () => {
    await inRepo(
      {
        "a.ts": "export const a = 1;\n",
        "tsconfig.json": '{ "compilerOptions": ',
      },
      async (root) => {
        const outcome = await checkOne(bunCheckAdapter(), {
          path: "a.ts",
          root,
        });
        expect(outcome.status).toBe("incomplete");
        expect(outcome.reason).toContain("tsconfig.json");
      }
    );
  }
);

withEngine(
  "a file that is not there yet is left to the adapter that keeps it",
  async () => {
    await inRepo({}, async (root) => {
      expect(
        await checkOne(bunCheckAdapter(), { path: "kept.ts", root })
      ).toEqual({ findings: [], status: "passed" });
    });
  }
);
