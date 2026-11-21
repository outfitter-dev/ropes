import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { recoverTaplo } from "../src/adapters/taplo/wasm.ts";

const SCHEMA = '{"type":"object","properties":{"name":{"type":"string"}}}\n';
const CAUSE = "native Taplo proxy panic";

const inRepo = async (
  body: (root: string, parent: string) => Promise<void>
): Promise<void> => {
  const parent = await realpath(
    await mkdtemp(path.join(tmpdir(), "taplo-config-"))
  );
  const root = path.join(parent, "repo");
  const configured = Bun.env.TAPLO_CONFIG;
  delete Bun.env.TAPLO_CONFIG;
  try {
    await mkdir(root);
    await Bun.write(path.join(root, "sample.toml"), "name = 42\n");
    await Bun.write(path.join(root, "schema.json"), SCHEMA);
    await body(root, parent);
  } finally {
    if (configured === undefined) {
      delete Bun.env.TAPLO_CONFIG;
    } else {
      Bun.env.TAPLO_CONFIG = configured;
    }
    await rm(parent, { force: true, recursive: true });
  }
};

test("an explicit relative Taplo config overrides discovery and keeps schema paths relative to cwd", async () => {
  await inRepo(async (root) => {
    await Bun.write(
      path.join(root, ".taplo.toml"),
      "[schema]\nenabled = false\n"
    );
    await Bun.write(
      path.join(root, "config", "team.toml"),
      '[schema]\npath = "schema.json"\n'
    );
    await Bun.write(path.join(root, "config", "schema.json"), "{}\n");
    Bun.env.TAPLO_CONFIG = "config/team.toml";
    const result = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(result.status).toBe("findings");
    expect(result.findings[0]?.rule).toBe("schema");
  });
});

test("an explicit absolute Taplo config preserves exclusions", async () => {
  await inRepo(async (root, parent) => {
    const config = path.join(parent, "team.toml");
    await Bun.write(config, 'exclude = ["sample.toml"]\n');
    Bun.env.TAPLO_CONFIG = config;
    const result = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(result.status).toBe("incomplete");
    expect(result.reason).toContain(CAUSE);
    expect(result.reason).toContain("Its config excluded it");
  });
});

test("an ancestor Taplo config applies its schema with the original working directory", async () => {
  await inRepo(async (root, parent) => {
    await Bun.write(
      path.join(parent, ".taplo.toml"),
      '[schema]\npath = "schema.json"\n'
    );
    await Bun.write(path.join(parent, "schema.json"), "{}\n");
    const result = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(result.status).toBe("findings");
    expect(result.findings[0]?.rule).toBe("schema");
  });
});

test("an ancestor taplo.toml preserves an excluded file", async () => {
  await inRepo(async (root, parent) => {
    await Bun.write(
      path.join(parent, "taplo.toml"),
      'exclude = ["sample.toml"]\n'
    );
    const result = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(result.status).toBe("incomplete");
    expect(result.reason).toContain(CAUSE);
    expect(result.reason).toContain("Its config excluded it");
  });
});

test("the nearest Taplo config takes precedence over an ancestor", async () => {
  await inRepo(async (root, parent) => {
    await Bun.write(
      path.join(parent, ".taplo.toml"),
      'exclude = ["sample.toml"]\n'
    );
    await Bun.write(path.join(root, "taplo.toml"), "");
    const result = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(result.status).toBe("passed");
  });
});

test("ambiguous native config discovery stays incomplete", async () => {
  await inRepo(async (root) => {
    await Bun.write(path.join(root, ".taplo.toml"), "");
    await Bun.write(path.join(root, "taplo.toml"), "");
    const result = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(result.status).toBe("incomplete");
    expect(result.reason).toContain(
      "Cannot confirm native Taplo config precedence"
    );
  });
});

test("empty and missing explicit configs keep the native cause", async () => {
  await inRepo(async (root) => {
    Bun.env.TAPLO_CONFIG = "";
    const empty = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(empty.status).toBe("incomplete");
    expect(empty.reason).toContain("TAPLO_CONFIG is empty");
    Bun.env.TAPLO_CONFIG = "missing.toml";
    const missing = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(missing.status).toBe("incomplete");
    expect(missing.reason).toContain(CAUSE);
  });
});

test("a selected config that cannot parse stays incomplete", async () => {
  await inRepo(async (root) => {
    await Bun.write(path.join(root, ".taplo.toml"), "");
    await Bun.write(path.join(root, "team.toml"), "exclude = 42\n");
    Bun.env.TAPLO_CONFIG = "team.toml";
    const result = await recoverTaplo(root, "sample.toml", CAUSE);
    expect(result.status).toBe("incomplete");
    expect(result.reason).toContain(CAUSE);
    expect(result.reason).toContain("could not use its own config");
  });
});
