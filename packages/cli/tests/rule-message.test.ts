import { expect, test } from "bun:test";
import path from "node:path";

import { explainRule } from "@ropes/core";

import { runEntry, withFixture } from "../../cinch/tests/acceptance-repo.ts";
import { FILES, RATIONALE } from "./trace-fixture.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);

test("rule lookup accepts a native rule with no authored message", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    await Promise.all(
      Object.entries(FILES).map(([file, text]) =>
        Bun.write(
          path.join(main.root, file),
          text.replace(
            "message: Import PrivateType through the public entry point.\n",
            ""
          )
        )
      )
    );
    const result = await explainRule({
      cwd: main.root,
      paths: ["src/a file.ts"],
      rule: "local/private-import",
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.value.rule.message).toBeUndefined();
    expect(result.value.rule.rationale).toBe(RATIONALE);
    expect(result.value.paths[0]?.state).toBe("planned");
    const displayed = await runEntry(
      CLI,
      ["explain", "--rule", "local/private-import", "src/a file.ts"],
      main.root,
      emptyPath
    );
    expect(displayed.exitCode).toBe(0);
    expect(displayed.stdout).toContain(RATIONALE);
    expect(displayed.stdout).not.toContain("undefined");

    if (Bun.which("ast-grep") === null) {
      if (process.env.CI === "true") {
        throw new Error(
          "The message-free rule check requires ast-grep on PATH."
        );
      }
      console.warn(
        "skipped: ast-grep is required to verify a message-free rule with the native engine"
      );
      return;
    }
    const checked = await runEntry(
      CLI,
      ["check", "src/a file.ts", "--json"],
      main.root
    );
    expect(checked.exitCode).toBe(1);
    expect(checked.stdout).toContain('"rule": "local/private-import"');
  });
});
