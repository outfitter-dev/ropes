#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Builds `cinch` as one executable that needs no Bun where it runs. The
 * presets go in as text, since a Cinch version is a preset version.
 *
 *   bun packages/cinch/scripts/build-binary.ts <outfile> [target]
 *
 * Without a target, the build is for the machine it runs on. This writes a file and publishes nothing.
 */
const PACKAGE = path.join(import.meta.dir, "..");
const PRESETS = path.join(PACKAGE, "presets");

/** The platforms Outfitter uses. The names are Bun's. */
const TARGETS = [
  "bun-darwin-arm64",
  "bun-linux-arm64",
  "bun-linux-x64",
] as const;

const [outfile, wanted] = process.argv.slice(2);
const target = TARGETS.find((name) => name === wanted);
if (outfile === undefined || (wanted !== undefined && target === undefined)) {
  process.stderr.write(
    `usage: build-binary.ts <outfile> [${TARGETS.join(" | ")}]\n`
  );
  process.exit(2);
}

const found = await readdir(PRESETS);
const names = found.toSorted();
const texts = await Promise.all(
  names.map((name) => Bun.file(path.join(PRESETS, name)).text())
);
const shipped = Object.fromEntries(
  names.map((name, index) => [name, texts[index] ?? ""])
);

const built = await Bun.build({
  compile: target === undefined ? { outfile } : { outfile, target },
  define: { CINCH_SHIPPED: JSON.stringify(shipped) },
  entrypoints: [path.join(PACKAGE, "src/cli.ts")],
});
for (const log of built.logs) {
  process.stderr.write(`${log.message}\n`);
}
if (!built.success) {
  process.exit(1);
}
process.stdout.write(`${outfile}\n`);
