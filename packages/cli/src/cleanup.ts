import { compareMigration, EXIT_CODE } from "@ropes/core";
import { renderCleanup } from "@ropes/core/render";

import { fail, print } from "./output.ts";

export const migrationCommand = async (
  verb: string,
  paths: readonly string[],
  values: {
    readonly migration?: string | undefined;
    readonly parent?: string | undefined;
    readonly candidate?: string | undefined;
    readonly at?: string | undefined;
    readonly trace?: boolean | undefined;
  },
  json: boolean
): Promise<number | null> => {
  if (values.migration !== undefined) {
    if (
      !["check", "explain"].includes(verb) ||
      paths.length > 0 ||
      values.parent === undefined ||
      values.candidate === undefined ||
      values.trace === true
    ) {
      return fail(
        "Migration comparisons require explain or check, --parent and --candidate, with no path filters or trace.",
        json
      );
    }
    const compared = await compareMigration(
      {
        ...(values.at === undefined ? {} : { at: values.at }),
        candidate: values.candidate,
        cwd: process.cwd(),
        parent: values.parent,
        policy: values.migration,
      },
      verb === "check"
    );
    if (!compared.ok) {
      return fail(compared.error, json);
    }
    print(
      json
        ? JSON.stringify(compared.value, null, 2)
        : renderCleanup(compared.value)
    );
    return verb === "explain" ? 0 : EXIT_CODE[compared.value.outcome];
  }
  if (values.parent !== undefined || values.candidate !== undefined) {
    return fail("--parent and --candidate require --migration.", json);
  }
  return null;
};
