import { writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig, ROPES_FILE } from "../config/load.ts";
import { parseConfigTable } from "../config/parse.ts";
import type { FixReport } from "../contracts/fix.ts";
import { unifiedDiff } from "../render/diff.ts";
import type { Operation } from "./command.ts";
import { writePlan } from "./fix.ts";
import type { CommandDeps, Prepared } from "./prepare.ts";
import { prepareSetup } from "./setup.ts";
import {
  inheritedBy,
  sparing,
  starterConfig,
  STARTER_CONFIG,
} from "./starter.ts";

export interface InitRequest {
  readonly cwd: string;
  readonly dryRun?: boolean;
  readonly strict?: boolean;
  readonly yes?: boolean;
}

const branded = (text: string): string =>
  text.replace("# Cinch config.", "# Ropes config.");

const priorConfig =
  "This repository already uses a Cinch config. Run `rope migrate` to preview the conversion.";
const configChanged =
  "The repository config changed during setup. Run rope init again.";

const prepareStarter = async (
  request: InitRequest,
  deps: CommandDeps,
  text: string
): Promise<
  Operation<{ readonly fresh: boolean; readonly setup: Prepared }>
> => {
  const starter = parseConfigTable(Bun.TOML.parse(text), {
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
  return prepared.ok
    ? {
        ok: true,
        value: {
          fresh: prepared.value.config === starter.value,
          setup: prepared.value,
        },
      }
    : prepared;
};

const starterFor = async ({
  adapters,
  plan,
  root,
}: Prepared): Promise<string> => {
  const found = await inheritedBy(adapters, root.root);
  const kept = [
    ...plan.paths.map((file) => file.path),
    ...found.flatMap((input) => input.keeps ?? []),
  ];
  return branded(starterConfig(sparing(found, kept)));
};

const writeFresh = async (
  setup: Prepared,
  starter: string,
  dryRun: boolean
): Promise<Operation<FixReport>> => {
  const { root } = setup;
  // Installing a policy changes what every other command reads. Settle the
  // proposed setup in scratch first, including untracked migration inputs.
  const preview = await writePlan(setup, { dryRun: true, mode: "doctor" });
  if (!preview.ok || preview.value.result.outcome !== "clean") {
    return preview;
  }
  if (!dryRun) {
    const current = await loadConfig(root.root);
    if (!current.ok || current.value.file !== null) {
      return { error: configChanged, ok: false };
    }
    // An overlapping init must never replace another writer's config.
    await writeFile(path.join(root.root, ROPES_FILE), starter, { flag: "wx" });
  }
  const ran = dryRun
    ? preview
    : await writePlan(setup, { dryRun, mode: "doctor" });
  if (!ran.ok) {
    return ran;
  }
  return {
    ok: true,
    value: {
      ...ran.value,
      changed: [ROPES_FILE, ...ran.value.changed],
      diff: unifiedDiff(ROPES_FILE, "", starter) + ran.value.diff,
    },
  };
};

export const runRopesInit = async (
  request: InitRequest,
  deps: CommandDeps
): Promise<Operation<FixReport>> => {
  const initial = branded(STARTER_CONFIG);
  const prepared = await prepareStarter(request, deps, initial);
  if (!prepared.ok) {
    return prepared;
  }
  const { fresh, setup } = prepared.value;
  if (setup.config.file !== ROPES_FILE) {
    return { error: priorConfig, ok: false };
  }
  const dryRun = request.yes !== true || request.dryRun === true;
  if (!fresh) {
    return await writePlan(setup, { dryRun, mode: "doctor" });
  }
  const starter = await starterFor(setup);
  if (starter === initial) {
    return await writeFresh(setup, starter, dryRun);
  }
  const revised = await prepareStarter(request, deps, starter);
  if (!revised.ok) {
    return revised;
  }
  return revised.value.fresh
    ? await writeFresh(revised.value.setup, starter, dryRun)
    : { error: configChanged, ok: false };
};
