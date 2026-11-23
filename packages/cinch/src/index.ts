import manifest from "../package.json" with { type: "json" };
import { adaptersFor } from "./adapters/registry.ts";
import { runCheck } from "./commands/check.ts";
import { runCleanup } from "./commands/cleanup.ts";
import type { FixRequest, ReadRequest } from "./commands/command.ts";
import { runDoctor } from "./commands/doctor.ts";
import type { DoctorRequest } from "./commands/doctor.ts";
import { runExplain } from "./commands/explain.ts";
import { runFix } from "./commands/fix.ts";
import { runMigrationPreview } from "./commands/migrate.ts";
import { capturePolicy } from "./commands/policy-preview.ts";
import type { PresetRequest } from "./commands/preset-operation.ts";
import { runRopesPreset } from "./commands/preset.ts";
import { runRopesInit } from "./commands/ropes-init.ts";
import type { InitRequest } from "./commands/ropes-init.ts";
import { runTrace } from "./commands/trace.ts";
import type { CleanupRequest } from "./contracts/cleanup.ts";

export type { FixRequest, Operation, ReadRequest } from "./commands/command.ts";
export type { Explanation } from "./commands/explain.ts";
export type { InitRequest } from "./commands/ropes-init.ts";
export type { MigrationPreview } from "./commands/migrate.ts";
export type { DoctorRequest } from "./commands/doctor.ts";
export type { DoctorReport } from "./contracts/doctor.ts";
export type { FixReport } from "./contracts/fix.ts";
export {
  parseCleanup,
  parseFinding,
  parsePlan,
  parseResult,
} from "./contracts/parse.ts";
export type { Plan } from "./contracts/plan.ts";
export type {
  PolicyPreview,
  PolicySnapshot,
} from "./contracts/policy-preview.ts";
export { previewPolicy } from "./commands/policy-preview.ts";
export { EXIT_CODE, exitCodeOf } from "./contracts/result.ts";
export type { ExitCode, Result } from "./contracts/result.ts";
export type { CheckTrace } from "./contracts/trace.ts";
export { readRepairs, saveRepair } from "./commands/repairs.ts";
export { resolveLocalCli } from "./commands/local-cli.ts";
export type { LocalCliRequest } from "./commands/local-cli.ts";
export type { RepairInput, RepairRecord } from "./contracts/repair.ts";

export type { PresetRequest } from "./commands/preset-operation.ts";
export type { PresetResponse } from "./contracts/preset.ts";

const deps = { adapters: adaptersFor };

export const preset = (request: PresetRequest) => runRopesPreset(request, deps);
export const doctor = (request: DoctorRequest) => runDoctor(request, deps);
export const check = (request: ReadRequest) => runCheck(request, deps);
export const explain = (request: ReadRequest, probeTools = false) =>
  runExplain(request, deps, probeTools);
export const fix = (request: FixRequest) => runFix(request, deps, "rope");
export const init = (request: InitRequest) => runRopesInit(request, deps);
export const previewMigration = (cwd: string) => runMigrationPreview(cwd, deps);
export const trace = (request: ReadRequest) => runTrace(request, deps);

export type { CleanupRequest, CleanupReport } from "./contracts/cleanup.ts";
export const compareMigration = (request: CleanupRequest, execute = true) =>
  runCleanup(request, deps, execute);
export const snapshotPolicy = (request: ReadRequest) =>
  capturePolicy(request, deps, `${manifest.name}@${manifest.version}`);

export { listRopesSchemas, ropesSchema } from "./commands/schema.ts";

export { prepareRuntime, STANDALONE } from "./runtime.ts";
