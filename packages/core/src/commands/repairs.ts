import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { discoverRoot, toRootRelative } from "../config/root.ts";
import { RepairInputSchema, RepairRecordSchema } from "../contracts/repair.ts";
import type { RepairRecord } from "../contracts/repair.ts";
import type { Operation } from "./command.ts";
import { describeRootError } from "./errors.ts";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Save one observation. The caller keeps the check verdict if storage fails. */
export const saveRepair = async (
  directory: string,
  input: unknown
): Promise<Operation<{ readonly id: string; readonly created: boolean }>> => {
  let temporary: string | undefined;
  try {
    const observed = RepairInputSchema.parse(input);
    const found = await discoverRoot(observed.result.plan.root);
    if (!found.ok) {
      throw new Error(describeRootError(found.error));
    }
    const root = found.value.vcsRoot;
    const requested = path.resolve(directory);
    const selected = await toRootRelative(root, root, requested);
    if (selected.ok) {
      throw new Error("Repair records belong outside the working tree.");
    }
    await mkdir(requested, { mode: 0o700, recursive: true });
    const destination = await realpath(requested);
    const created = await toRootRelative(root, root, destination);
    if (created.ok) {
      throw new Error("The record directory resolves inside the working tree.");
    }
    const id = createHash("sha256")
      .update(
        JSON.stringify([
          observed.repository,
          observed.event.host,
          observed.event.session,
          observed.event.id,
        ])
      )
      .digest("hex");
    const record: RepairRecord = {
      ...observed,
      capturedAt: new Date().toISOString(),
      evidence: "observed",
      id,
      schemaVersion: 1,
    };
    const file = path.join(destination, `${id}.json`);
    temporary = path.join(destination, `${id}-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(record, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporary, file);
      return { ok: true, value: { created: true, id } };
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
      const existing = RepairRecordSchema.parse(await Bun.file(file).json());
      if (existing.id !== id) {
        throw new Error(
          "An existing repair record has a conflicting identity.",
          { cause: error }
        );
      }
      return { ok: true, value: { created: false, id } };
    }
  } catch (error) {
    return { error: messageOf(error), ok: false };
  } finally {
    if (temporary !== undefined) {
      await rm(temporary, { force: true }).catch(() => {
        // A leftover temporary file is ignored by the reader.
      });
    }
  }
};

/** Read portable observations without consulting Git, an engine, or a service. */
export const readRepairs = async (
  directory: string
): Promise<Operation<readonly RepairRecord[]>> => {
  try {
    const files = await readdir(directory);
    const records = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) =>
          RepairRecordSchema.parse(
            await Bun.file(path.join(directory, file)).json()
          )
        )
    );
    return {
      ok: true,
      value: records.toSorted(
        (a, b) =>
          a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id)
      ),
    };
  } catch (error) {
    return { error: messageOf(error), ok: false };
  }
};
