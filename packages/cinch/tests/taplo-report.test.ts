import { expect, test } from "bun:test";
import path from "node:path";

import { exec } from "../src/adapters/exec.ts";
import { taploAdapter } from "../src/adapters/taplo/adapter.ts";
import { checkOne } from "./one-file.ts";
import { check, fakeTaplo, inRepo } from "./taplo-fixture.ts";

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
