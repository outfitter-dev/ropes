import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import {
  SUPPORTED_RANGE,
  taploAdapter,
} from "../src/adapters/taplo/adapter.ts";
import { checkOne, fixOne } from "./one-file.ts";

const SCHEMA = new URL("../schemas/cinch.schema.json", import.meta.url)
  .pathname;

const installed = Bun.which("taplo") !== null;
/** A real-engine test. It says so when the engine is not there to run it. */
const withEngine = (name: string, body: () => Promise<void>) => {
  test(name, async () => {
    if (!installed) {
      console.warn(`skipped: taplo is not on PATH, so "${name}" did not run`);
      return;
    }
    await body();
  });
};

const inRepo = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "cinch-taplo-"))
  );
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

const checked = (files: Readonly<Record<string, string>>, file: string) =>
  inRepo(files, (root) => checkOne(taploAdapter(), { path: file, root }));

test("the adapter checks TOML, never writes, and follows the pin", () => {
  expect(taploAdapter().descriptor).toMatchObject({
    enabledBy: "toml.enabled",
    extensions: [".toml"],
    versionRange: SUPPORTED_RANGE,
    writes: false,
  });
  const pinned = adaptersFor({ taplo: "0.10.0" }).find(
    (adapter) => adapter.descriptor.id === "taplo"
  );
  expect(pinned?.descriptor.versionRange).toBe("0.10.0");
});

test("a missing binary is reported by the probe, not thrown", async () => {
  const probe = await taploAdapter({ command: "no-such-taplo" }).probe();
  expect(probe).toEqual({
    available: false,
    reason: "no-such-taplo is not on PATH",
  });
});

withEngine("valid TOML passes", async () => {
  expect(await checked({ "a.toml": 'name = "a"\n' }, "a.toml")).toMatchObject({
    findings: [],
    status: "passed",
  });
});

withEngine("TOML that does not parse is a finding at its place", async () => {
  const outcome = await checked({ "a.toml": "name = \n" }, "a.toml");
  expect(outcome.status).toBe("findings");
  expect(outcome.findings[0]).toMatchObject({
    path: "a.toml",
    range: { start: { line: 1 } },
    rule: "syntax",
    severity: "error",
  });
});

withEngine("a config the schema refuses is a schema finding", async () => {
  const files = {
    ".taplo.toml": `[[rule]]\ninclude = ["rope.toml"]\n\n[rule.schema]\npath = ${JSON.stringify(SCHEMA)}\n`,
    "rope.toml": "pilot = 0\nnope = 1\n",
  };
  const outcome = await checked(files, "rope.toml");
  expect(outcome.status).toBe("findings");
  expect(new Set(outcome.findings.map((finding) => finding.rule))).toEqual(
    new Set(["schema"])
  );
  expect(outcome.findings[0]?.message).toContain("'nope' was unexpected");
});

withEngine(
  "a file the engine's own config excludes is incomplete",
  async () => {
    const files = {
      ".taplo.toml": 'exclude = ["a.toml"]\n',
      "a.toml": "a = 1\n",
    };
    const outcome = await checked(files, "a.toml");
    expect(outcome.status).toBe("incomplete");
    expect(outcome.reason).toContain("did not read the file");
  }
);

withEngine("a config the engine cannot use is incomplete", async () => {
  const files = { ".taplo.toml": "exclude = 42\n", "a.toml": "a = 1\n" };
  const outcome = await checked(files, "a.toml");
  expect(outcome.status).toBe("incomplete");
  expect(outcome.reason).toContain("could not use its own config");
});

withEngine("a path with glob characters names that file only", async () => {
  const files = { "config1.toml": "a = 1\n", "config[1].toml": "a = \n" };
  const outcome = await checked(files, "config[1].toml");
  expect(outcome.status).toBe("findings");
  expect(outcome.findings[0]?.path).toBe("config[1].toml");
  const sibling = await checked(files, "config1.toml");
  expect(sibling.status).toBe("passed");
});

withEngine("keys that conflict are a syntax finding", async () => {
  const outcome = await checked({ "a.toml": "a = 1\na = 2\n" }, "a.toml");
  expect(outcome.findings.map((finding) => finding.rule)).toEqual(["syntax"]);
  const table = await checked({ "a.toml": "a = 1\n[a.b]\nc = 2\n" }, "a.toml");
  expect(table.findings.map((finding) => finding.rule)).toEqual(["syntax"]);
});

withEngine(
  "a kept file that is not written yet has nothing to lint",
  async () => {
    expect(await checked({}, "kept.toml")).toEqual({
      findings: [],
      status: "passed",
    });
  }
);

withEngine("fix only checks, and leaves the file as it was", async () => {
  await inRepo({ "a.toml": "name   =   'a'\n" }, async (root) => {
    const outcome = await fixOne(taploAdapter(), { path: "a.toml", root });
    expect(outcome.status).toBe("passed");
    expect(await Bun.file(path.join(root, "a.toml")).text()).toBe(
      "name   =   'a'\n"
    );
  });
});
