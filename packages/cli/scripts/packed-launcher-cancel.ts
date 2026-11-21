import assert from "node:assert/strict";
import path from "node:path";

/** A signal addressed only to the launcher PID must stop a later write. */
export const proveCancellation = async (
  folder: string,
  cwd: string,
  executable: string,
  selected: string
): Promise<void> => {
  const before = await Bun.file(selected).text();
  const ready = path.join(folder, "cancel-ready");
  const write = path.join(folder, "unexpected-write");
  await Bun.write(
    selected,
    `
if (process.argv[2] !== "fix") throw new Error("Expected delegated fix");
await Bun.write(${JSON.stringify(ready)}, "ready");
await Bun.sleep(1000);
await Bun.write(${JSON.stringify(write)}, "later write batch");
`
  );
  const child = Bun.spawn([process.execPath, executable, "fix"], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- poll until the selected process reaches the cancellable point
      if (await Bun.file(ready).exists()) {
        break;
      }
      // eslint-disable-next-line no-await-in-loop -- bounded readiness poll
      await Bun.sleep(10);
    }
    assert.equal(await Bun.file(ready).exists(), true);
    child.kill("SIGTERM");
    assert.equal(await child.exited, 143);
    await Bun.sleep(1100);
    assert.equal(await Bun.file(write).exists(), false);
  } finally {
    child.kill();
    await child.exited;
    await Bun.write(selected, before);
  }
};
