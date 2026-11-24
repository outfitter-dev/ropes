import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { YAML } from "bun";

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a workflow mapping");
  }
  return Object.fromEntries(Object.entries(value));
};
const workflow: unknown = YAML.parse(
  await Bun.file(
    new URL("../.github/workflows/npm-release.yml", import.meta.url)
  ).text()
);
const publish = object(object(object(workflow).jobs).publish);
const { steps } = publish;
if (!Array.isArray(steps)) {
  throw new TypeError("Missing publication steps");
}
const script = steps
  .map((value: unknown) => object(value))
  .find((step) => step.name === "Publish core, then CLI")?.run;
if (typeof script !== "string") {
  throw new TypeError("Missing release publication step");
}
const fixture = new URL("npm-release-fixture.ts", import.meta.url).pathname;

const rehearse = async (
  options: {
    published?: Record<string, number>;
    metadataDelay?: number;
    archiveDelay?: number;
    wrongTag?: boolean;
    wrongBytes?: boolean;
  } = {}
) => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-release-"));
  try {
    const bin = path.join(root, "bin");
    await mkdir(bin);
    await Promise.all(
      ["curl", "npm", "date", "sleep"].map(async (name) => {
        const wrapper = path.join(bin, name);
        await Bun.write(
          wrapper,
          `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "${name}" "$@"\n`
        );
        await chmod(wrapper, 0o755);
      })
    );
    await Bun.write(path.join(root, "clock"), "0");
    await Bun.write(path.join(root, "events"), "");
    await Promise.all(
      Object.entries(options.published ?? {}).map(([name, time]) =>
        Bun.write(path.join(root, `published-${name}`), String(time))
      )
    );
    await Promise.all(
      ["core", "cli"].map((name) =>
        Bun.write(path.join(root, `${name}.tgz`), `approved ${name}`)
      )
    );
    const summary = path.join(root, "summary");
    const child = Bun.spawn(["bash", "-c", script], {
      cwd: root,
      env: {
        ...process.env,
        ARCHIVE_DELAY: String(options.archiveDelay ?? 0),
        DIST_TAG: "canary",
        GITHUB_STEP_SUMMARY: summary,
        METADATA_DELAY: String(options.metadataDelay ?? 0),
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RELEASE_FIXTURE: root,
        RUNNER_TEMP: root,
        VERSION: "0.1.0-canary.4",
        WRONG_BYTES: String(options.wrongBytes ?? false),
        WRONG_TAG: String(options.wrongTag ?? false),
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const events = await Bun.file(path.join(root, "events")).text();
    return {
      events: events.trim().split("\n"),
      exitCode,
      now: Number(await Bun.file(path.join(root, "clock")).text()),
      output: stdout + stderr,
      summary: (await Bun.file(summary).exists())
        ? await Bun.file(summary).text()
        : "",
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("publication waits for metadata and archives beyond five minutes", async () => {
  const result = await rehearse({ archiveDelay: 660, metadataDelay: 360 });
  expect(result.exitCode).toBe(0);
  expect(result.now).toBe(1320);
  expect(result.events.filter((event) => event.startsWith("publish"))).toEqual([
    "publish core",
    "publish cli",
  ]);
  expect(result.events.indexOf("publish cli")).toBeGreaterThan(
    result.events.lastIndexOf("archive core")
  );
  expect(result.summary).toContain("Verified @ropes/core@0.1.0-canary.4");
  expect(result.summary).toContain("Verified @ropes/cli@0.1.0-canary.4");
  expect(publish["timeout-minutes"]).toBeGreaterThan(30);
}, 30_000);

test("a same-artifact rerun verifies published versions without publishing again", async () => {
  const result = await rehearse({
    archiveDelay: 660,
    published: { cli: 0, core: 0 },
  });
  expect(result.exitCode).toBe(0);
  expect(result.events.filter((event) => event.startsWith("publish"))).toEqual(
    []
  );
}, 30_000);

test("an unavailable tarball times out with exact-input recovery guidance", async () => {
  const result = await rehearse({ archiveDelay: 1200 });
  expect(result.exitCode).toBe(1);
  expect(result.now).toBe(900);
  expect(result.output).toContain("waiting for public tarball for @ropes/core");
  expect(result.output).toContain("same artifact ID and SHA-256 inputs");
  expect(result.events).not.toContain("publish cli");
}, 30_000);

test("missing version metadata has its own bounded timeout", async () => {
  const result = await rehearse({ metadataDelay: 1200 });
  expect(result.exitCode).toBe(1);
  expect(result.now).toBe(900);
  expect(result.output).toContain(
    "waiting for version metadata for @ropes/core"
  );
  expect(result.events.filter((event) => event.startsWith("archive"))).toEqual(
    []
  );
}, 30_000);

test("a different tag and different public bytes cannot pass verification", async () => {
  const tag = await rehearse({ wrongTag: true });
  expect(tag.exitCode).toBe(1);
  expect(tag.output).toContain("waiting for dist-tag for @ropes/core");
  expect(tag.events.filter((event) => event.startsWith("archive"))).toEqual([]);
  const bytes = await rehearse({ wrongBytes: true });
  expect(bytes.exitCode).toBe(1);
  expect(bytes.output).toContain("differs from the approved candidate");
  expect(bytes.now).toBe(0);
  expect(bytes.events).not.toContain("publish cli");
}, 30_000);
