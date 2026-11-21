import assert from "node:assert/strict";
import { chmod, mkdir, realpath, symlink } from "node:fs/promises";
import path from "node:path";

import type { PortableRepo } from "./portable-repo.ts";

/** The installed core resolves its own fallback dependency in an isolated install. */
export const provePortableTaplo = async (repo: PortableRepo) => {
  if (process.platform !== "darwin") {
    return;
  }
  const tools = path.join(repo.root, "..", "portable-taplo");
  await mkdir(tools);
  const git = Bun.which("git");
  if (git === null) {
    throw new Error("The packed Taplo proof requires Git on PATH");
  }
  await symlink(await realpath(git), path.join(tools, "git"));
  const native = path.join(tools, "taplo");
  await Bun.write(
    native,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'taplo 0.10.0'; exit 0; fi
echo "thread 'main' panicked at /native/system-configuration-0.5.1/src/dynamic_store.rs:154:1:" >&2
echo 'Attempted to create a NULL object.' >&2
exit 101
`
  );
  await chmod(native, 0o755);
  assert.equal(Bun.which("bun", { PATH: tools }), null);
  await repo.write(
    "rope.toml",
    'pilot = 0\ninclude = ["sample.toml"]\n[markdown]\nenabled = false\npreset = false\n[toml]\nenabled = true\n'
  );
  await repo.write("sample.toml", 'name = "ropes"\n');
  await repo.write(
    "schema.json",
    '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}\n'
  );
  await repo.write(".taplo.toml", '[schema]\npath = "schema.json"\n');
  const valid = await repo.check(["sample.toml"], tools);
  assert.equal(valid.steps[0]?.status, "passed");
  assert.match(valid.steps[0]?.reason ?? "", /WebAssembly/u);
  await repo.write("sample.toml", "name = 42\n");
  const invalid = await repo.check(["sample.toml"], tools, 1);
  assert.equal(invalid.steps[0]?.findings[0]?.rule, "schema");
  await repo.write(".taplo.toml", '[schema]\npath = "missing-schema.json"\n');
  const missing = await repo.check(["sample.toml"], tools, 2);
  assert.equal(missing.steps[0]?.status, "incomplete");
  assert.match(
    missing.steps[0]?.reason ?? "",
    /Attempted to create a NULL object\./u
  );
  console.log(
    "Packed core recovered a native Taplo panic, checked its schema, and kept a missing schema incomplete."
  );
};
