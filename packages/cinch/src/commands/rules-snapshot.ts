import path from "node:path";

import type { ConfigText } from "../adapters/relocation.ts";
import { parseConfigTable } from "../config/parse.ts";
import { discoverRoot } from "../config/root.ts";
import type { CinchConfig } from "../contracts/config.ts";
import type { Operation, ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, Prepared } from "./prepare.ts";
import { configText } from "./relocate.ts";

interface PolicySnapshot extends ConfigText {
  readonly original: string;
}

export const matchesPolicySnapshot = (
  snapshot: ConfigText,
  config: CinchConfig
): boolean => {
  try {
    let table: unknown = Bun.TOML.parse(snapshot.text);
    for (const key of snapshot.prefix.split(".").filter(Boolean)) {
      table =
        typeof table === "object" && table !== null && key in table
          ? Reflect.get(table, key)
          : undefined;
    }
    const parsed = parseConfigTable(table, {
      file: snapshot.file,
      prefix: snapshot.prefix,
    });
    return parsed.ok && Bun.deepEquals(parsed.value, config);
  } catch {
    return false;
  }
};

export const policyStillCurrent = async (
  root: string,
  snapshot: PolicySnapshot,
  before: string
): Promise<boolean> => {
  const current = await configText(root);
  return (
    !("error" in current) &&
    current.file === snapshot.file &&
    current.prefix === snapshot.prefix &&
    before === snapshot.original &&
    current.text === snapshot.text
  );
};

export const prepareAdoption = async (
  request: ReadRequest,
  deps: CommandDeps,
  requireConfig: boolean
): Promise<
  Operation<{ readonly prepared: Prepared; readonly text: PolicySnapshot }>
> => {
  const located = await discoverRoot(request.cwd);
  if (!located.ok) {
    return {
      error: "Could not locate the repository for rule adoption.",
      ok: false,
    };
  }
  const text = await configText(located.value.root);
  if ("error" in text) {
    return { error: text.error, ok: false };
  }
  const handle = Bun.file(path.join(located.value.root, text.file));
  const original = (await handle.exists()) ? await handle.text() : "";
  const prepared = await prepare({ ...request, paths: [] }, deps);
  if (!prepared.ok) {
    return prepared;
  }
  const { config } = prepared.value;
  if (requireConfig && config.file === null) {
    return {
      error:
        "Run `rope init` to preview a policy config before adopting rule packs.",
      ok: false,
    };
  }
  if (config.file !== null && !matchesPolicySnapshot(text, config)) {
    return {
      error: "The policy changed during adoption. Run the command again.",
      ok: false,
    };
  }
  return {
    ok: true,
    value: { prepared: prepared.value, text: { ...text, original } },
  };
};
