import { EXIT_CODE, previewPolicy, snapshotPolicy } from "@ropes/core";
import type { ReadRequest } from "@ropes/core";
import { renderPolicyPreview } from "@ropes/core/render";

import { fail, print } from "./output.ts";

export const policy = async (
  request: ReadRequest,
  json: boolean
): Promise<number> => {
  const [action, ...paths] = request.paths;
  if (action === "snapshot") {
    const captured = await snapshotPolicy({ ...request, paths });
    if (!captured.ok) {
      return fail(captured.error, json);
    }
    print(JSON.stringify(captured.value, null, 2));
    return EXIT_CODE.clean;
  }
  const [before, after] = paths;
  if (
    action !== "compare" ||
    before === undefined ||
    after === undefined ||
    paths.length !== 2 ||
    request.at !== undefined
  ) {
    return fail(
      "Use policy snapshot [path...] or policy compare <before.json> <after.json>. --at is only for capture.",
      json
    );
  }
  const compared = await previewPolicy(request.cwd, before, after);
  if (!compared.ok) {
    return fail(compared.error, json);
  }
  print(
    json
      ? JSON.stringify(compared.value, null, 2)
      : renderPolicyPreview(compared.value)
  );
  return compared.value.incomplete.length === 0
    ? EXIT_CODE.clean
    : EXIT_CODE.incomplete;
};
