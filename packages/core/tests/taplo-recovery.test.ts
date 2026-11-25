import { expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";

import { recoverTaplo } from "../src/adapters/taplo/wasm.ts";
import { check, fakeTaplo, inRepo } from "./taplo-fixture.ts";

const ROPE = new URL("../../cli/src/cli.ts", import.meta.url);

test.skipIf(process.platform !== "darwin")(
  "rope recovers the specific macOS proxy panic with the packaged WebAssembly engine",
  async () => {
    await inRepo(async (root, bin) => {
      await fakeTaplo(
        bin,
        "thread 'main' panicked at /cargo/system-configuration-0.5.1/src/dynamic_store.rs:154:1:\nAttempted to create a NULL object.",
        101
      );
      const wasmBin = path.join(root, "wasm-bin");
      await mkdir(wasmBin);
      await symlink(
        new URL(import.meta.resolve("@taplo/cli/dist/cli.js")).pathname,
        path.join(wasmBin, "taplo")
      );
      // Hoisted package managers can put the fallback tool ahead of native Taplo.
      const searchPath = [wasmBin, bin, Bun.env.PATH].join(path.delimiter);
      const invoke = (json = true) => check(root, searchPath, json, ROPE);
      const valid = await invoke(false);
      expect(valid.exitCode).toBe(0);
      expect(valid.stdout).toContain("Checked with Taplo WebAssembly 0.9.0");

      const file = path.join(root, "a.toml");
      await Bun.write(file, "a = [\n");
      const invalid = await invoke();
      expect(invalid.exitCode).toBe(1);
      expect(JSON.parse(invalid.stdout)).toMatchObject({
        outcome: "findings",
        steps: [
          {
            findings: [{ path: "a.toml", rule: "syntax" }],
            reason:
              "Checked with Taplo WebAssembly 0.9.0 after native Taplo panicked",
          },
        ],
      });

      const config = path.join(root, ".taplo.toml");
      await Bun.write(config, '[schema]\npath = "schema.json"\n');
      await Bun.write(file, "a = 1\n");
      const missing = await invoke();
      expect(missing.exitCode).toBe(2);
      expect(missing.stdout).toContain("Attempted to create a NULL object.");
      expect(missing.stdout).toContain("failed to load schema");

      await Bun.write(
        path.join(root, "schema.json"),
        '{"type":"object","properties":{"a":{"type":"string"}}}\n'
      );
      const invalidSchema = await invoke();
      expect(invalidSchema.exitCode).toBe(1);
      expect(JSON.parse(invalidSchema.stdout)).toMatchObject({
        outcome: "findings",
        steps: [{ findings: [{ path: "a.toml", rule: "schema" }] }],
      });

      await Bun.write(config, 'exclude = ["a.toml"]\n');
      const excluded = await invoke();
      expect(excluded.exitCode).toBe(2);
      expect(excluded.stdout).toContain("Its config excluded it");
      expect(excluded.stdout).toContain("Attempted to create a NULL object.");
    });
  }
);

test("Taplo WebAssembly stops waiting for an unresponsive schema", async () => {
  await inRepo(async (root) => {
    const response = Promise.withResolvers<Response>();
    let requests = 0;
    const server = Bun.serve({
      fetch: () => {
        requests += 1;
        return response.promise;
      },
      hostname: "127.0.0.1",
      idleTimeout: 0,
      port: 0,
    });
    try {
      await Bun.write(
        path.join(root, ".taplo.toml"),
        `[schema]\nurl = "${server.url.href}schema.json"\n`
      );
      expect(await recoverTaplo(root, "a.toml", "native Taplo panic")).toEqual({
        findings: [],
        reason:
          "native Taplo panic\nTaplo WebAssembly: did not finish within 10 seconds",
        status: "incomplete",
      });
      expect(requests).toBe(1);
    } finally {
      response.resolve(new Response(null, { status: 503 }));
      await server.stop(true);
    }
  });
}, 15_000);
