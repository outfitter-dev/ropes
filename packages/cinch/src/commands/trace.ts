import type { CheckTrace, TracedBatch } from "../contracts/trace.ts";
import type { Operation, ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, Prepared } from "./prepare.ts";

export const tracePrepared = async ({
  adapters,
  plan,
  root,
}: Prepared): Promise<CheckTrace> => {
  const batches = await Promise.all(
    plan.batches.map(async (batch): Promise<TracedBatch> => {
      const adapter = adapters.find(
        ({ descriptor }) => descriptor.id === batch.adapter
      );
      if (adapter?.describeCheck === undefined) {
        return {
          batch,
          description: {
            error: "This adapter does not describe its check invocation yet.",
            ok: false,
          },
        };
      }
      try {
        return {
          batch,
          description: await adapter.describeCheck({
            package: batch.package,
            paths: batch.paths,
            root: plan.root,
            ...(batch.rules === undefined ? {} : { rules: batch.rules }),
          }),
        };
      } catch (error) {
        return {
          batch,
          description: {
            error: error instanceof Error ? error.message : String(error),
            ok: false,
          },
        };
      }
    })
  );
  return {
    batches,
    configFile: root.configFile,
    evidence: "planned",
    plan,
    schemaVersion: plan.schemaVersion,
  };
};

/** Add planned invocation data to the existing resolver's explanation. */
export const runTrace = async (
  request: ReadRequest,
  deps: CommandDeps
): Promise<Operation<CheckTrace>> => {
  const prepared = await prepare(request, deps);
  if (!prepared.ok) {
    return prepared;
  }
  return { ok: true, value: await tracePrepared(prepared.value) };
};
