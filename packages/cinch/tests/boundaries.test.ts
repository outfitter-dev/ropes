import { expect, test } from "bun:test";
import path from "node:path";

import { Glob } from "bun";

const SRC = new URL("../src/", import.meta.url).pathname;

/** Which layers each layer may import from. `cli.ts` sits above all of them. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  adapters: ["adapters", "contracts"],
  commands: [
    "adapters",
    "commands",
    "config",
    "contracts",
    "policy",
    "render",
    "runner",
  ],
  config: ["config", "contracts"],
  contracts: ["contracts"],
  policy: ["adapters", "contracts", "policy"],
  render: ["contracts", "render"],
  runner: ["adapters", "contracts", "runner"],
};

/** Modules that perform I/O. The resolver, contracts and renderers stay pure. */
const IO_MODULES = new Set([
  "node:fs",
  "node:child_process",
  "node:process",
  "bun",
]);
const PURE_LAYERS = new Set(["contracts", "policy", "render"]);

const IMPORT = /from\s+"(?<specifier>[^"]+)"/gu;
const ENGINE_FOLDER = /^adapters\/(?<engine>[^/]+)\//u;
const MIGRATION_FOLDER =
  /^adapters\/(?<engine>[^/]+)\/migrate\/(?<from>[^/]+)\//u;
const CONCRETE_ADAPTER = /\/adapters\/[^/]+\//u;
const BUN_GLOBAL = /\bBun\./u;

interface Source {
  readonly file: string;
  readonly layer: string;
  readonly text: string;
  readonly imports: readonly string[];
}

/**
 * The layer a relative import lands in, wherever the importing file sits.
 * Undefined for a package import and for a file at the top of `src/`.
 */
const targetLayer = (file: string, specifier: string): string | undefined => {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const target = path.posix.join(path.posix.dirname(file), specifier);
  return target.includes("/") ? target.split("/")[0] : undefined;
};

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
        const target = targetLayer(source.file, specifier);
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

test("the resolver, the contracts and the renderers perform no I/O", () => {
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

test("only the registry and an engine's own folder mention the engine", () => {
  const engines = new Set(
    sources.flatMap((source) => {
      const engine = ENGINE_FOLDER.exec(source.file)?.groups?.engine;
      return engine === undefined ? [] : [engine];
    })
  );
  const offenders = [...engines].flatMap((engine) =>
    sources
      .filter(
        (source) =>
          source.file !== "adapters/registry.ts" &&
          !source.file.startsWith(`adapters/${engine}/`) &&
          source.text.toLowerCase().includes(engine)
      )
      .map((source) => `${source.file} mentions ${engine}`)
  );
  expect(offenders).toEqual([]);
});

test("an engine's folder is imported only from inside it and by the registry", () => {
  const offenders = sources
    .filter((source) => source.file !== "adapters/registry.ts")
    .flatMap((source) =>
      source.imports
        .filter((specifier) => specifier.startsWith("."))
        .map((specifier) =>
          path.posix.join(path.posix.dirname(source.file), specifier)
        )
        .filter((target) => {
          const engine = ENGINE_FOLDER.exec(target)?.groups?.engine;
          return (
            engine !== undefined &&
            !source.file.startsWith(`adapters/${engine}/`)
          );
        })
        .map((target) => `${source.file} imports ${target}`)
    );
  expect(offenders).toEqual([]);
});

test("only the adapter that takes over from a tool mentions that tool", () => {
  const taken = sources.flatMap((source) => {
    const found = MIGRATION_FOLDER.exec(source.file)?.groups;
    return found?.engine === undefined || found.from === undefined
      ? []
      : [{ engine: found.engine, from: found.from }];
  });
  expect(taken.length).toBeGreaterThan(0);
  const offenders = taken.flatMap(({ engine, from }) =>
    sources
      .filter(
        (source) =>
          !source.file.startsWith(`adapters/${engine}/`) &&
          source.text.toLowerCase().includes(from)
      )
      .map((source) => `${source.file} mentions ${from}`)
  );
  expect([...new Set(offenders)]).toEqual([]);
});

test("the layout has the layers the boundary rules describe", () => {
  const layers = new Set(sources.map((source) => source.layer));
  for (const layer of [
    "adapters",
    "commands",
    "contracts",
    "policy",
    "render",
    "runner",
  ]) {
    expect(layers.has(layer)).toBe(true);
  }
});
