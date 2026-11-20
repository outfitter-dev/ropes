import { devNull } from "node:os";

export const run = async (
  command: readonly string[],
  cwd: string,
  options: { exitCode?: number; searchPath?: string } = {}
): Promise<string> => {
  const child = Bun.spawn([...command], {
    cwd,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
      ),
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      ...(options.searchPath === undefined ? {} : { PATH: options.searchPath }),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== (options.exitCode ?? 0)) {
    throw new Error(`${command.join(" ")} exited ${code}\n${stdout}${stderr}`);
  }
  return stdout;
};
