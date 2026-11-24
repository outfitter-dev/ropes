import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { pinsFrom, readPins } from "../src/adapters/pins.ts";

const withMise = async (text: string | null) => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-pins-"));
  try {
    if (text !== null) {
      await Bun.write(path.join(root, "mise.toml"), text);
    }
    return await readPins(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("reads exact versions from the tools table, in either spelling", () => {
  expect(
    pinsFrom({ tools: { bun: "1.4.4", rumdl: { version: "0.3.5" } } })
  ).toEqual({ bun: "1.4.4", rumdl: "0.3.5" });
});

test("an entry that is not a three-part version is not a pin", () => {
  expect(pinsFrom({ tools: { a: "latest", b: "1", c: ["1.2.3"] } })).toEqual(
    {}
  );
  expect(pinsFrom({})).toEqual({});
  expect(pinsFrom(null)).toEqual({});
});

test("a repository without mise.toml has no pins", async () => {
  expect(await withMise(null)).toEqual({ ok: true, pins: {} });
});

test("reads the pins from mise.toml under the root", async () => {
  expect(await withMise('[tools]\nrumdl = "0.3.5"\n')).toEqual({
    ok: true,
    pins: { rumdl: "0.3.5" },
  });
});

test("a mise.toml that does not parse is an error, not an empty set", async () => {
  const result = await withMise("[tools\n");
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.message).toStartWith(
    "mise.toml could not be read: "
  );
});
