import { expect, test } from "bun:test";
import path from "node:path";

import { FailureSchema } from "../../core/src/contracts/failure.ts";
import { runEntry, withFixture } from "../../core/tests/acceptance-repo.ts";

const entry = new URL("../src/cli.ts", import.meta.url);

test.each(["rope: missing.md", "cinch: missing.md", "first\nrope: missing.md"])(
  "JSON operation failures preserve the literal filename %j",
  async (filename) => {
    await withFixture(async ({ main }) => {
      const result = await runEntry(
        entry,
        ["explain", filename, "--json"],
        main.root
      );
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: { message: `${filename} does not exist.` },
      });
    });
  }
);

test("JSON setup failures join multiple raw problems without display prefixes", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(
      path.join(main.root, "rope.toml"),
      'pilot = 0\nexclude = [".editorconfig", "bunfig.toml"]\n[markdown]\nenabled = false\n[toml]\nenabled = false\n[editor]\nindent_size = 2\n[install]\nisolated = true\n'
    );
    const result = await runEntry(entry, ["doctor", "--json"], main.root);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    const failure = FailureSchema.parse(JSON.parse(result.stderr));
    const { message } = failure.error;
    expect(message).toContain(".editorconfig");
    expect(message).toContain("bunfig.toml");
    expect(message.split("\n")).toHaveLength(2);
    expect(message).not.toContain("rope: ");
  });
});
