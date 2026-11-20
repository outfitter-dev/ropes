import { afterAll, expect, test } from "bun:test";

import {
  CINCH,
  CONFIG,
  EXTENDS,
  ROOT,
  cleanUp,
  move,
  read,
  repo,
} from "./relocate-repo.ts";

afterAll(cleanUp);

const OWN = `${EXTENDS}
[MD007]
indent = 4

[MD013]
line-length = 120
code-blocks = false

[global]
exclude = ["vendor/**"]
disable = ["MD033"]
`;

/** What the engine resolves, without the note of which file said it. */
const resolved = async (root: string): Promise<string> => {
  const child = Bun.spawn(["rumdl", "config", "--color", "never"], {
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [out, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(await new Response(child.stderr).text());
  }
  return out.replaceAll(/\s*\[from [^\]]*\]/gu, "");
};

test("the engine resolves the same before, after absorb and after eject", async () => {
  if (Bun.which("rumdl") === null) {
    console.warn(
      "skipped: rumdl is not on PATH, so the absorb and eject round trip did not run against it"
    );
    return;
  }
  const root = await repo({ [ROOT]: OWN });
  const before = await resolved(root);
  expect(before).toContain("line-length = 120");

  const absorbed = await move(root, "absorb", { yes: true });
  expect(absorbed.exitCode).toBe(0);
  expect(await read(root, CINCH)).not.toBe(CONFIG);
  expect(await resolved(root)).toBe(before);

  const ejected = await move(root, "eject", { yes: true });
  expect(ejected.exitCode).toBe(0);
  expect(await read(root, CINCH)).toBe(CONFIG);
  expect(await resolved(root)).toBe(before);
});
