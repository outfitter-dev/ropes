import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { render } from "../src/adapters/bun-install/read.ts";

test("Bun enforces the generated release age, exact exception and isolated linker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-install-native-"));
  const source = path.join(root, "source");
  const project = path.join(root, "project");
  const name = `ropes-install-proof-${crypto.randomUUID()}`;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    await Promise.all([mkdir(source), mkdir(project)]);
    await Promise.all([
      Bun.write(
        path.join(source, "package.json"),
        JSON.stringify({ main: "index.js", name, version: "1.0.0" })
      ),
      Bun.write(path.join(source, "index.js"), "export const proof = true;\n"),
      Bun.write(
        path.join(project, "package.json"),
        JSON.stringify({
          dependencies: { [name]: "1.0.0" },
          name: "consumer",
          trustedDependencies: [],
        })
      ),
    ]);
    const pack = Bun.spawn(
      [process.execPath, "pm", "pack", "--destination", root],
      { cwd: source, stderr: "pipe", stdout: "pipe" }
    );
    await Promise.all([pack.stdout.text(), pack.stderr.text()]);
    expect(await pack.exited).toBe(0);
    const tarball = Bun.file(path.join(root, `${name}-1.0.0.tgz`));
    const bytes = await tarball.bytes();
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    server = Bun.serve({
      fetch: (request) =>
        new URL(request.url).pathname.endsWith(".tgz")
          ? new Response(tarball)
          : Response.json({
              "dist-tags": { latest: "1.0.0" },
              name,
              time: { "1.0.0": new Date().toISOString() },
              versions: {
                "1.0.0": {
                  dist: {
                    integrity,
                    tarball: new URL("proof.tgz", request.url).href,
                  },
                  name,
                  version: "1.0.0",
                },
              },
            }),
      hostname: "127.0.0.1",
      port: 0,
    });
    const run = async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          "install",
          "--registry",
          server?.url.href ?? "",
          "--ignore-scripts",
        ],
        {
          cwd: project,
          env: {
            ...process.env,
            BUN_INSTALL_CACHE_DIR: path.join(root, "cache"),
          },
          stderr: "pipe",
          stdout: "pipe",
        }
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        child.stdout.text(),
        child.stderr.text(),
      ]);
      return { exitCode, output: stdout + stderr };
    };
    const settings = { isolated: true, minimum_release_age: "7 days" };
    await Bun.write(path.join(project, "bunfig.toml"), render(settings));
    const blocked = await run();
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.output).toContain(name);
    await Bun.write(
      path.join(project, "bunfig.toml"),
      render({
        ...settings,
        release_age_exempt: [`${name}@1.0.0`],
      })
    );
    const accepted = await run();
    expect(accepted.exitCode).toBe(0);
    const link = await readlink(path.join(project, "node_modules", name));
    expect(link).toContain(".bun");
    expect(
      await Bun.file(
        path.join(project, "node_modules", name, "index.js")
      ).text()
    ).toContain("proof = true");
  } finally {
    await server?.stop(true);
    await rm(root, { force: true, recursive: true });
  }
}, 20_000);
