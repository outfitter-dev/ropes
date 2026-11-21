import { enginePath } from "./stand-in.ts";

export interface Exit {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command to completion and collects what it printed. */
export const exec = async (
  command: readonly string[],
  cwd?: string,
  env?: Readonly<Record<string, string>>
): Promise<Exit> => {
  const searchPath = await enginePath();
  const child = Bun.spawn([...command], {
    ...(cwd === undefined ? {} : { cwd }),
    env: {
      ...Bun.env,
      ...env,
      ...(searchPath === undefined ? {} : { PATH: searchPath }),
    },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
};
