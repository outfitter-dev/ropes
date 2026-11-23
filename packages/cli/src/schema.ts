import { EXIT_CODE, listRopesSchemas, ropesSchema } from "@ropes/core";

import { fail, print } from "./output.ts";

export const schema = (paths: readonly string[], json: boolean): number => {
  const name = paths.join(" ");
  if (name === "") {
    const listing = listRopesSchemas();
    print(
      json
        ? JSON.stringify(listing, null, 2)
        : [
            "Run `rope schema <command>` for the JSON Schema of its --json output.",
            "",
            ...listing.commands.map((command) => `  ${command}`),
            "",
            "Run `rope schema config` for the JSON Schema of rope.toml.",
          ].join("\n")
    );
    return EXIT_CODE.clean;
  }
  const found = ropesSchema(name);
  if (found === undefined) {
    return fail(
      `No schema for "${name}". Run rope schema for the available names.`,
      json
    );
  }
  print(JSON.stringify(found, null, 2));
  return EXIT_CODE.clean;
};
