import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CommandRequest } from "../src/commands/command.ts";
import { commands } from "../src/commands/registry.ts";
import { RelocateReportSchema } from "../src/contracts/relocate.ts";
import type { RelocateReport } from "../src/contracts/relocate.ts";

export const CINCH = "cinch.toml";
export const SHARED = "outfitter.toml";
export const ROOT = ".rumdl.toml";
export const GENERATED = ".outfitter/configs/rumdl.toml";
export const EXTENDS = `extends = ${JSON.stringify(GENERATED)}\n`;
export const CONFIG = "pilot = 0\n\n[markdown]\nenabled = true\n";

const roots: string[] = [];
export const cleanUp = () =>
  Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));

const preset = (root: string, request: Partial<CommandRequest>) => {
  const command = commands.preset;
  if (!command) {
    throw new Error("no preset command");
  }
  return command({ cwd: root, json: true, paths: ["markdown"], ...request });
};

/**
 * A repository with these files and the Markdown preset's own in place. It
 * gets a standalone Cinch config unless the files hold the shared one.
 */
export const repo = async (files: Readonly<Record<string, string>>) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-mv-")));
  roots.push(root);
  await mkdir(path.join(root, ".git"));
  await Promise.all(
    Object.entries(SHARED in files ? files : { [CINCH]: CONFIG, ...files }).map(
      ([name, text]) => Bun.write(path.join(root, name), text)
    )
  );
  await preset(root, { action: "add" });
  return root;
};

export const read = (root: string, file: string): Promise<string> =>
  Bun.file(path.join(root, file)).text();

export const move = async (
  root: string,
  action: "adopt" | "eject",
  request: Partial<CommandRequest> = {}
): Promise<{ readonly exitCode: number; readonly report: RelocateReport }> => {
  const response = await preset(root, { action, ...request });
  if (response.output === undefined) {
    throw new Error(response.error ?? "no output");
  }
  return {
    exitCode: response.exitCode,
    report: RelocateReportSchema.parse(JSON.parse(response.output)),
  };
};
