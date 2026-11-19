import { expect, test } from "bun:test";

import { Glob } from "bun";

const SRC = new URL("../src/", import.meta.url).pathname;

/** Which layers each layer may import from. `cli.ts` sits above all of them. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  adapters: ["adapters", "contracts"],
  commands: ["adapters", "commands", "config", "contracts", "policy", "runner"],
  config: ["config", "contracts"],
  contracts: ["contracts"],
  policy: ["adapters", "contracts", "policy"],
  runner: ["adapters", "contracts", "runner"],
};

/** Modules that perform I/O. The resolver and the contracts must stay pure. */
const IO_MODULES = new Set([
  "node:fs",
  "node:child_process",
  "node:process",
  "bun",
]);
const PURE_LAYERS = new Set(["contracts", "policy"]);

const IMPORT = /from\s+"(?<specifier>[^"]+)"/gu;
const LAYER_IMPORT = /^\.\.\/(?<layer>[^/]+)\//u;
const CONCRETE_ADAPTER = /\/adapters\/[^/]+\//u;
const BUN_GLOBAL = /\bBun\./u;

interface Source {
  readonly file: string;
  readonly layer: string;
  readonly text: string;
  readonly imports: readonly string[];
}

const read = async (file: string): Promise<Source> => {
  const text = await Bun.file(`${SRC}${file}`).text();
  return {
    file,
    imports: [...text.matchAll(IMPORT)].map(
      (match) => match.groups?.specifier ?? ""
    ),
    layer: file.includes("/") ? (file.split("/")[0] ?? "") : "",
    text,
  };
};

const files = await Array.fromAsync(new Glob("**/*.ts").scan({ cwd: SRC }));
const sources = await Promise.all(files.toSorted().map(read));

test("every layer imports only from the layers it is allowed to", () => {
  const violations = sources.flatMap((source) => {
    const allowed = ALLOWED[source.layer];
    if (!allowed) {
      return [];
    }
    return source.imports
      .filter((specifier) => {
        const target = LAYER_IMPORT.exec(specifier)?.groups?.layer;
        return target !== undefined && !allowed.includes(target);
      })
      .map((specifier) => `${source.file} imports ${specifier}`);
  });
  expect(violations).toEqual([]);
});

test("only cli.ts parses arguments", () => {
  const offenders = sources
    .filter(
      (source) =>
        source.file !== "cli.ts" && source.imports.includes("node:util")
    )
    .map((source) => source.file);
  expect(offenders).toEqual([]);
});

test("the resolver and the contracts perform no I/O", () => {
  const offenders = sources
    .filter((source) => PURE_LAYERS.has(source.layer))
    .filter(
      (source) =>
        source.imports.some((specifier) => IO_MODULES.has(specifier)) ||
        BUN_GLOBAL.test(source.text)
    )
    .map((source) => source.file);
  expect(offenders).toEqual([]);
});

test("only the registry and an adapter's own folder name a concrete adapter", () => {
  const offenders = sources
    .filter((source) => source.layer !== "adapters")
    .flatMap((source) =>
      source.imports
        .filter((specifier) => CONCRETE_ADAPTER.test(specifier))
        .map((specifier) => `${source.file} imports ${specifier}`)
    );
  expect(offenders).toEqual([]);
});

test("the layout has the layers the boundary rules describe", () => {
  const layers = new Set(sources.map((source) => source.layer));
  for (const layer of [
    "adapters",
    "commands",
    "contracts",
    "policy",
    "runner",
  ]) {
    expect(layers.has(layer)).toBe(true);
  }
});
