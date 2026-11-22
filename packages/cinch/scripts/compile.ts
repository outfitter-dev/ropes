#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import path from "node:path";

import { Glob } from "bun";

/**
 * Builds a CLI as one executable that needs no Bun where it runs. The
 * presets and the rules go in as text, since a Cinch version is a preset
 * version and a rules version.
 *
 *   bun packages/cinch/scripts/build-binary.ts <outfile> [target]
 *
 * Without a target, the build is for the machine it runs on. This writes a file and publishes nothing.
 */
const PACKAGE = path.join(import.meta.dir, "..");
const PRESETS = path.join(PACKAGE, "presets");
const RULES = path.join(PACKAGE, "rules");

/** The platforms Outfitter uses. The names are Bun's. */
const TARGETS = [
  "bun-darwin-arm64",
  "bun-linux-arm64",
  "bun-linux-x64",
] as const;

export const buildBinary = async (entrypoint: string): Promise<void> => {
  const [outfile, wanted] = process.argv.slice(2);
  const target = TARGETS.find((name) => name === wanted);
  if (outfile === undefined || (wanted !== undefined && target === undefined)) {
    process.stderr.write(
      `usage: build-binary.ts <outfile> [${TARGETS.join(" | ")}]\n`
    );
    process.exit(2);
  }

  /** A preset goes in by its file name, a rule as `rules/<pack>/<rule>.yml`. */
  const presets = await readdir(PRESETS);
  const rules = await Array.fromAsync(new Glob("**/*").scan({ cwd: RULES }));
  const sources = [
    ...presets.map((name): [string, string] => [
      name,
      path.join(PRESETS, name),
    ]),
    ...rules.map((file): [string, string] => [
      `rules/${file}`,
      path.join(RULES, file),
    ]),
  ].toSorted(([left], [right]) => (left < right ? -1 : 1));
  const texts = await Promise.all(
    sources.map(([, file]) => Bun.file(file).text())
  );
  const shipped = Object.fromEntries(
    sources.map(([name], index) => [name, texts[index] ?? ""])
  );

  const embedTaplo =
    target === undefined
      ? process.platform === "darwin"
      : target === "bun-darwin-arm64";
  const built = await Bun.build({
    compile: target === undefined ? { outfile } : { outfile, target },
    define: {
      CINCH_SHIPPED: JSON.stringify(shipped),
      CINCH_TAPLO_WORKER: JSON.stringify(embedTaplo),
    },
    entrypoints: [entrypoint],
    // Bun can retain a dynamic import even when its worker is disabled.
    external: embedTaplo ? [] : ["@taplo/cli/dist/cli.js"],
  });
  for (const log of built.logs) {
    process.stderr.write(`${log.message}\n`);
  }
  if (!built.success) {
    process.exit(1);
  }
  process.stdout.write(`${outfile}\n`);
};
