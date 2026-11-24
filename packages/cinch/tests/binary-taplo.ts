import { expect } from "bun:test";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import { parseResult } from "../src/contracts/parse.ts";

/** Recover inside the compiled runtime, with no external Bun or fallback files. */
export const qualifyStandaloneTaplo = async (binary: string, root: string) => {
  const engines = path.join(root, "engines");
  await mkdir(engines);
  const taplo = path.join(engines, "taplo");
  await Bun.write(
    taplo,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'taplo 0.10.0'; exit 0; fi
echo "thread 'main' panicked at /native/system-configuration-0.5.1/src/dynamic_store.rs:154:1:" >&2
echo 'Attempted to create a NULL object.' >&2
exit 101
`
  );
  await chmod(taplo, 0o755);
  expect(Bun.which("bun", { PATH: engines })).toBeNull();
  await Bun.write(
    path.join(root, "rope.toml"),
    'pilot = 0\ninclude = ["sample.toml"]\n[markdown]\nenabled = false\npreset = false\n[toml]\nenabled = true\n'
  );
  await Bun.write(path.join(root, "sample.toml"), 'name = "ropes"\n');
  await Bun.write(
    path.join(root, "schema.json"),
    '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}\n'
  );
  await Bun.write(
    path.join(root, ".taplo.toml"),
    '[schema]\npath = "schema.json"\n'
  );
  const check = async (expected: number) => {
    const child = Bun.spawn([binary, "check", "sample.toml", "--json"], {
      cwd: root,
      env: { HOME: path.dirname(root), PATH: engines },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(expected);
    expect(stderr).toBe("");
    const parsed = parseResult(JSON.parse(stdout));
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.error));
    }
    return parsed.value.steps[0];
  };
  const valid = await check(0);
  expect(valid?.status).toBe("passed");
  expect(valid?.reason).toContain("WebAssembly");
  await Bun.write(path.join(root, "sample.toml"), "name = 42\n");
  const invalid = await check(1);
  expect(invalid?.status).toBe("findings");
  expect(invalid?.findings[0]?.rule).toBe("schema");
  await Bun.write(
    path.join(root, ".taplo.toml"),
    'exclude = ["sample.toml"]\n'
  );
  const excluded = await check(2);
  expect(excluded?.status).toBe("incomplete");
  expect(excluded?.reason).toContain("Attempted to create a NULL object.");
};
