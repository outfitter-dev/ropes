import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { exec } from "../src/adapters/exec.ts";
import { taploAdapter } from "../src/adapters/taplo/adapter.ts";
import { fixtureGit } from "./acceptance-repo.ts";
import { checkOne } from "./one-file.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);
const ROPE = new URL("../../cli/src/cli.ts", import.meta.url);

const inRepo = async (
  body: (root: string, bin: string) => Promise<void>
): Promise<void> => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "taplo-report-"))
  );
  const bin = path.join(root, "bin");
  try {
    await mkdir(bin);
    await Bun.write(path.join(root, "a.toml"), "a = 1\n");
    await Bun.write(path.join(root, "cinch.toml"), "pilot = 0\n");
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", "a.toml", "cinch.toml");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    await body(root, bin);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const fakeTaplo = async (bin: string, stderr: string, code: number) => {
  const command = path.join(bin, "taplo");
  await Bun.write(`${command}.stderr`, stderr);
  await Bun.write(
    command,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "taplo 0.10.0"; exit 0; fi',
      'printf "%s" "$RUST_LOG" > "$0.filter"',
      '/bin/cat "$0.stderr" >&2',
      `exit ${code}`,
      "",
    ].join("\n")
  );
  await chmod(command, 0o755);
  return command;
};

const check = async (
  root: string,
  searchPath: string,
  json = true,
  cli = CLI
) => {
  const child = Bun.spawn(
    [
      process.execPath,
      cli.pathname,
      "check",
      "a.toml",
      ...(json ? ["--json"] : []),
    ],
    {
      cwd: root,
      env: { ...Bun.env, PATH: searchPath, RUST_LOG: "error" },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
};

test("a Taplo panic after routine logs reaches human and JSON reports", async () => {
  await inRepo(async (root, bin) => {
    await fakeTaplo(
      bin,
      [
        " INFO taplo:load_config: found configuration file",
        " INFO taplo:lint_files:collect_files: found files total=1",
        " INFO taplo:lint_files:lint_file: checking a.toml",
        " INFO taplo:lint_files:lint_file: loading schema",
        "thread 'main' panicked at system-configuration/dynamic_store.rs:154:1:",
        "Attempted to create a NULL object.",
        "note: run with RUST_BACKTRACE=1 environment variable to display a backtrace",
      ].join("\n"),
      101
    );
    const searchPath = [bin, Bun.env.PATH].join(path.delimiter);
    await Promise.all(
      [true, false].map(async (json) => {
        const ran = await check(root, searchPath, json);
        expect(ran.exitCode).toBe(2);
        expect(ran.stdout).toContain("taplo exited 101:");
        expect(ran.stdout).toContain("Attempted to create a NULL object.");
        expect(ran.stdout).not.toContain("RUST_BACKTRACE");
        expect(ran.stdout).not.toContain("INFO taplo:");
        if (json) {
          expect(JSON.parse(ran.stdout)).toMatchObject({
            outcome: "incomplete",
          });
        }
      })
    );
  });
});

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

test("unexpected-exit diagnostics are bounded and handle empty stderr", async () => {
  await inRepo(async (root, bin) => {
    const command = await fakeTaplo(bin, "failure ".repeat(1000), 101);
    const outcome = await checkOne(taploAdapter({ command }), {
      path: "a.toml",
      root,
    });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.reason?.length).toBeLessThanOrEqual(1018);
    await fakeTaplo(bin, "", 101);
    expect(
      await checkOne(taploAdapter({ command }), { path: "a.toml", root })
    ).toMatchObject({
      reason: "taplo exited 101: no diagnostic output",
      status: "incomplete",
    });
  });
});

test("a silent successful engine still leaves its check incomplete", async () => {
  await inRepo(async (root, bin) => {
    await fakeTaplo(bin, "", 0);
    const ran = await check(root, [bin, Bun.env.PATH].join(path.delimiter));
    expect(ran.exitCode).toBe(2);
    expect(ran.stdout).toContain("did not say which files it read");
  });
});

test("native Taplo check keeps file evidence under a conflicting log filter", async () => {
  if (Bun.which("taplo") === null) {
    console.warn(
      "skipped: taplo is not on PATH, so native log-filter proof did not run"
    );
    return;
  }
  await inRepo(async (root) => {
    const valid = await check(root, Bun.env.PATH ?? "");
    expect(valid.exitCode).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({ outcome: "clean" });
    await Bun.write(path.join(root, ".taplo.toml"), 'exclude = ["a.toml"]\n');
    const excluded = await check(root, Bun.env.PATH ?? "");
    expect(excluded.exitCode).toBe(2);
    expect(excluded.stdout).toContain("did not read the file");
  });
});

test("the Taplo log filter stays local to its invocation", async () => {
  await inRepo(async (root, bin) => {
    const command = await fakeTaplo(bin, "", 101);
    const previous = Bun.env.RUST_LOG;
    Bun.env.RUST_LOG = "error";
    try {
      await checkOne(taploAdapter({ command }), { path: "a.toml", root });
      expect(await Bun.file(`${command}.filter`).text()).toBe("taplo=info");
      expect(Bun.env.RUST_LOG).toBe("error");
      await exec([command], root);
      expect(await Bun.file(`${command}.filter`).text()).toBe("error");
    } finally {
      if (previous === undefined) {
        delete Bun.env.RUST_LOG;
      } else {
        Bun.env.RUST_LOG = previous;
      }
    }
  });
});

test("an unexpected exit with routine logs alone keeps a bounded fallback", async () => {
  await inRepo(async (root, bin) => {
    const lines = Array.from(
      { length: 6 },
      (_, index) => ` INFO taplo: checking file ${index}`
    );
    const command = await fakeTaplo(bin, lines.join("\n"), 101);
    const outcome = await checkOne(taploAdapter({ command }), {
      path: "a.toml",
      root,
    });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.reason?.split("\n")).toHaveLength(4);
    expect(outcome.reason).toContain("checking file 0");
    expect(outcome.reason).not.toContain("checking file 4");
  });
});
