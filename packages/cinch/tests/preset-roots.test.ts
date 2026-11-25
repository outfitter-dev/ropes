import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import type { CommandRequest } from "../src/commands/command.ts";
import { createCommands } from "../src/commands/registry.ts";
import { DoctorReportSchema } from "../src/contracts/doctor.ts";
import { checkoutAt, fixtureGit } from "./acceptance-repo.ts";

const ON =
  "pilot = 0\n[markdown]\npreset = false\n[lint]\npreset = true\n[format]\npreset = true\n[typescript]\npreset = true\n";
const ROOTS = ["oxlint.config.ts", "oxfmt.config.ts", "tsconfig.json"];
const TS_PRESET = "./.outfitter/configs/presets/tsconfig.json";

const commands = createCommands({ adapters: adaptersFor });

let root = "";
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-roots-")));
  await mkdir(path.join(root, ".git"));
  await Bun.write(path.join(root, "cinch.toml"), ON);
  await Bun.write(
    path.join(root, "node_modules/ultracite/package.json"),
    JSON.stringify({ name: "ultracite", version: "8.1.1" })
  );
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const put = (file: string, text: string): Promise<number> =>
  Bun.write(path.join(root, file), text);
const text = (file: string): Promise<string> =>
  Bun.file(path.join(root, file)).text();

const doctor = async (request: Partial<CommandRequest> = {}) => {
  const command = commands.doctor;
  if (!command) {
    throw new Error("no doctor command");
  }
  const response = await command({
    cwd: root,
    json: true,
    paths: [],
    ...request,
  });
  const { result } = DoctorReportSchema.parse(
    JSON.parse(response.output ?? "null")
  );
  return { exitCode: response.exitCode, result };
};

/** The findings about one file, as `fixable: message`. */
const about = async (file: string): Promise<string[]> => {
  const { result } = await doctor();
  return result.steps
    .flatMap((step) => step.findings)
    .filter((finding) => finding.path === file)
    .map((finding) => `${finding.fixable}: ${finding.message}`);
};

test("every preset in the registry checks the tool's own config", () => {
  const presets = adaptersFor({}, {}, undefined)
    .map(({ descriptor }) => descriptor)
    .filter((descriptor) => descriptor.preset !== undefined);
  expect(presets.length).toBeGreaterThan(3);
  for (const descriptor of presets) {
    const roots = Object.values(descriptor.layers ?? {}).filter(
      (layer) => layer === "root"
    );
    expect(`${descriptor.id}: ${roots.length}`).toBe(`${descriptor.id}: 1`);
  }
});

test("doctor --fix writes each missing root config, and then it is clean", async () => {
  const fixed = await doctor({ fix: true });
  expect(fixed.exitCode).toBe(0);
  expect(await text("tsconfig.json")).toBe(
    `{\n  "extends": "${TS_PRESET}"\n}\n`
  );
  expect(await text("oxlint.config.ts")).toContain("extends: [preset]");
  expect(await text("oxfmt.config.ts")).toContain("...preset");
  const again = await doctor();
  expect(again.exitCode).toBe(0);
});

test.each(["oxlint.config.ts", "oxfmt.config.ts"])(
  "%s without the preset is a finding doctor --fix leaves alone",
  async (file) => {
    await doctor({ fix: true });
    const own = "export default {};\n";
    await put(file, own);
    const [finding = ""] = await about(file);
    expect(finding).toStartWith(`false: ${file} is the repository's own`);
    expect(finding).toContain("It does not import the preset Cinch keeps.");
    const fixed = await doctor({ fix: true });
    expect(fixed.exitCode).toBe(1);
    expect(await text(file)).toBe(own);
  }
);

test("an import in a comment, or of a type only, does not count", async () => {
  await doctor({ fix: true });
  await put(
    "oxlint.config.ts",
    '// import preset from "./.outfitter/configs/presets/oxlint.ts";\nimport type preset from "./.outfitter/configs/presets/oxlint.ts";\nexport default {};\n'
  );
  expect(await about("oxlint.config.ts")).toHaveLength(1);
});

test("a bare module specifier cannot import the local preset", async () => {
  await doctor({ fix: true });
  await put(
    "oxlint.config.ts",
    'import preset from ".outfitter/configs/presets/oxlint.ts";\nexport default preset;\n'
  );
  expect(await about("oxlint.config.ts")).toHaveLength(1);
});

test("a config the tool reads from another file stops the new one", async () => {
  await put(".oxlintrc.json", "{}\n");
  await doctor({ fix: true });
  expect(await Bun.file(path.join(root, "oxlint.config.ts")).exists()).toBe(
    false
  );
  const [finding = ""] = await about("oxlint.config.ts");
  expect(finding).toStartWith(
    "false: This repository keeps its config in .oxlintrc.json"
  );
});

test("a dry run sees a config git ignores, as the real run does", async () => {
  await fixtureGit(root, "init", "--quiet", "--template=");
  await put(".gitignore", ".oxlintrc.json\nnode_modules\n");
  await put(".oxlintrc.json", "{}\n");
  await fixtureGit(root, "check-ignore", "--quiet", ".oxlintrc.json");
  const preview = await checkoutAt(root).rope([
    "doctor",
    "--fix",
    "--dry-run",
    "--json",
  ]);
  expect(preview.exitCode).toBe(1);
  const { result } = DoctorReportSchema.parse(JSON.parse(preview.stdout));
  const found = result.steps
    .filter((step) => step.path === "oxlint.config.ts")
    .flatMap((step) => step.findings.map((finding) => finding.message));
  expect(found).toHaveLength(1);
  expect(found[0]).toContain("keeps its config in .oxlintrc.json");
});

test("a tsconfig.json with no extends gets the key and nothing else", async () => {
  const own =
    '// The { compiler } config.\n{\n  /* ours */\n  "include": ["src"], // all of it\n}\n';
  await put("tsconfig.json", own);
  const [finding = ""] = await about("tsconfig.json");
  expect(finding).toStartWith("true: tsconfig.json is the repository's own");
  await doctor({ fix: true });
  expect(await text("tsconfig.json")).toBe(
    `// The { compiler } config.\n{\n  "extends": "${TS_PRESET}",\n  /* ours */\n  "include": ["src"], // all of it\n}\n`
  );
  expect(await about("tsconfig.json")).toEqual([]);
});

test("an empty tsconfig.json gets the key with no comma after it", async () => {
  await put("tsconfig.json", "{}\n");
  await doctor({ fix: true });
  expect(await text("tsconfig.json")).toBe(
    `{\n  "extends": "${TS_PRESET}"\n}\n`
  );
});

test.each([
  `{ "extends": "${TS_PRESET}" }`,
  JSON.stringify({ extends: TS_PRESET.slice(0, -".json".length) }),
  JSON.stringify({ extends: TS_PRESET.replaceAll("/", "\\") }),
  `{ "extends": ["./base.json", "${TS_PRESET}"] }`,
])("%s extends the preset", async (own) => {
  await put("tsconfig.json", own);
  expect(await about("tsconfig.json")).toEqual([]);
});

test("a bare preset path is a package specifier, not a relative extends", async () => {
  const own = JSON.stringify({ extends: TS_PRESET.slice(2) });
  await put("tsconfig.json", own);
  const [finding = ""] = await about("tsconfig.json");
  expect(finding).toContain("not the preset Cinch keeps");
  await doctor({ fix: true });
  expect(await text("tsconfig.json")).toBe(own);
});

test("an existing extensionless config takes precedence over the preset", async () => {
  const exact = TS_PRESET.slice(0, -".json".length);
  const own = JSON.stringify({ extends: exact });
  await fixtureGit(root, "init", "--quiet", "--template=");
  await put("tsconfig.json", own);
  await put(exact, "{}");
  await put(".gitignore", `${exact.slice(2)}\nnode_modules\n`);
  await fixtureGit(root, "check-ignore", "--quiet", exact);
  const [finding = ""] = await about("tsconfig.json");
  expect(finding).toContain("not the preset Cinch keeps");
  const preview = await checkoutAt(root).rope([
    "doctor",
    "--fix",
    "--dry-run",
    "--json",
  ]);
  expect(preview.exitCode).toBe(1);
  const { result } = DoctorReportSchema.parse(JSON.parse(preview.stdout));
  const previewFinding = result.steps
    .flatMap((step) => step.findings)
    .find((item) => item.path === "tsconfig.json");
  expect(previewFinding?.message).toContain("not the preset Cinch keeps");
});

test("a tsconfig.json that extends something else is left for a person", async () => {
  const own = '{ "extends": "./base.json" }\n';
  await put("tsconfig.json", own);
  const [finding = ""] = await about("tsconfig.json");
  expect(finding).toContain('It extends "./base.json", not the preset');
  expect(finding).toStartWith("false:");
  await doctor({ fix: true });
  expect(await text("tsconfig.json")).toBe(own);
});

test("a tsconfig.json that cannot be read is a finding, not a rewrite", async () => {
  await put("tsconfig.json", "{ nope\n");
  const [finding = ""] = await about("tsconfig.json");
  expect(finding).toContain("It could not be read");
  await doctor({ fix: true });
  expect(await text("tsconfig.json")).toBe("{ nope\n");
});

test("with the presets off, no root config is checked or written", async () => {
  await put("cinch.toml", "pilot = 0\n");
  await doctor({ fix: true });
  const here = await Promise.all(
    ROOTS.map((file) => Bun.file(path.join(root, file)).exists())
  );
  expect(here).toEqual([false, false, false]);
});
