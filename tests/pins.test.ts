import { expect, test } from "bun:test";
import path from "node:path";

// mise.toml is the one place tool versions are pinned. These tests fail when
// another file that has to repeat a version stops agreeing with it.
const root = path.resolve(import.meta.dir, "..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (source: unknown, ...keys: string[]): unknown => {
  let current = source;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
};

const readToml = async (name: string): Promise<unknown> =>
  Bun.TOML.parse(await Bun.file(path.join(root, name)).text());

const pins = async (): Promise<Record<string, string>> => {
  const tools = field(await readToml("mise.toml"), "tools");
  if (!isRecord(tools)) {
    throw new Error("mise.toml has no [tools] table");
  }
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(tools)) {
    const version = typeof entry === "string" ? entry : field(entry, "version");
    if (typeof version !== "string") {
      throw new TypeError(`mise.toml pins ${name} without a string version`);
    }
    result[name] = version;
  }
  return result;
};

test("every tool is pinned to an exact version", async () => {
  for (const version of Object.values(await pins())) {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
  }
});

test("package.json repeats the Bun pin from mise.toml", async () => {
  const { bun } = await pins();
  const manifest: unknown = await Bun.file(
    path.join(root, "package.json")
  ).json();
  expect(field(manifest, "packageManager")).toBe(`bun@${bun}`);
  expect(field(manifest, "engines", "bun")).toBe(`>=${bun}`);
  expect(field(manifest, "devDependencies", "@types/bun")).toBe(bun);
});

test("mise.lock holds the versions mise.toml pins", async () => {
  const lock = await readToml("mise.lock");
  for (const [name, version] of Object.entries(await pins())) {
    const entries = field(lock, "tools", name);
    const locked = Array.isArray(entries)
      ? entries.map((entry) => field(entry, "version"))
      : [];
    expect(locked).toEqual([version]);
  }
});

test("the local link engine keeps static Linux assets under its public pin name", async () => {
  const lock = await readToml("mise.lock");
  const entries = field(lock, "tools", "lychee");
  expect(Array.isArray(entries)).toBe(true);
  const entry: unknown = Array.isArray(entries) ? entries[0] : undefined;
  expect(field(entry, "backend")).toBe("github:lycheeverse/lychee");
  expect(field(entry, "options", "libc")).toBe("musl");
  const linux = Object.entries(isRecord(entry) ? entry : {}).filter(([key]) =>
    key.startsWith("platforms.linux-")
  );
  expect(linux.length).toBeGreaterThan(0);
  for (const [, platform] of linux) {
    expect(field(platform, "url")).toMatch(/-unknown-linux-musl\.tar\.gz$/u);
  }
});
