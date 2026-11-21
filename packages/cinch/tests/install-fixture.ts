import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const INSTALL_SETTINGS = {
  isolated: true,
  minimum_release_age: "7 days",
};
export const INSTALL_CONFIG = `pilot = 0
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[install]
isolated = true
minimum_release_age = "7 days"
`;

export const withInstallFixture = async (
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>
) => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-install-"));
  try {
    await mkdir(path.join(root, ".git"));
    await Promise.all(
      Object.entries(files).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};
