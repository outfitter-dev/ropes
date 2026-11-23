import { writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig, ROPES_FILE } from "../config/load.ts";
import { parseConfigTable } from "../config/parse.ts";
import type { FixReport } from "../contracts/fix.ts";
import { unifiedDiff } from "../render/diff.ts";
import type { Operation } from "./command.ts";
import { writePlan } from "./fix.ts";
import type { CommandDeps } from "./prepare.ts";
import { prepareSetup } from "./setup.ts";
import { STARTER_CONFIG } from "./starter.ts";

export interface InitRequest {
  readonly cwd: string;
  readonly dryRun?: boolean;
  readonly strict?: boolean;
  readonly yes?: boolean;
}

const starterText = STARTER_CONFIG.replace(
  "# Cinch config.",
  "# Ropes config."
);

const priorConfig =
  "This repository already uses a Cinch config. Run `rope migrate` to preview the conversion.";

export const runRopesInit = async (
  request: InitRequest,
  deps: CommandDeps
): Promise<Operation<FixReport>> => {
  const starter = parseConfigTable(Bun.TOML.parse(starterText), {
    file: ROPES_FILE,
    prefix: "",
  });
  if (!starter.ok) {
    return { error: "The bundled Ropes starter config is invalid.", ok: false };
  }
  const prepared = await prepareSetup(request.cwd, deps, {
    starter: starter.value,
    strict: request.strict === true,
  });
  if (!prepared.ok) {
    return prepared;
  }
  const setup = prepared.value;
  if (setup.config.file !== ROPES_FILE) {
    return { error: priorConfig, ok: false };
  }
  const fresh = setup.config === starter.value;
  const dryRun = request.yes !== true || request.dryRun === true;
  if (fresh && !dryRun) {
    const current = await loadConfig(setup.root.root);
    if (!current.ok || current.value.file !== null) {
      return {
        error:
          "The repository config changed during setup. Run rope init again.",
        ok: false,
      };
    }
    // An overlapping init must never replace another writer's config.
    await writeFile(path.join(setup.root.root, ROPES_FILE), starterText, {
      flag: "wx",
    });
  }
  const ran = await writePlan(setup, { dryRun, mode: "doctor" });
  if (!ran.ok || !fresh) {
    return ran;
  }
  return {
    ok: true,
    value: {
      ...ran.value,
      changed: [ROPES_FILE, ...ran.value.changed],
      diff: unifiedDiff(ROPES_FILE, "", starterText) + ran.value.diff,
    },
  };
};
