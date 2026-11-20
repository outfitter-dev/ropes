import { expect, test } from "bun:test";

import { createCommands } from "../src/commands/registry.ts";
import { OUTPUT_SCHEMAS } from "../src/commands/schema.ts";

test("every command that prints JSON has a schema, and nothing else does", () => {
  const commands = Object.keys(createCommands({ adapters: () => [] }));
  const documented = new Set(
    Object.keys(OUTPUT_SCHEMAS).map((name) => name.split(" ")[0])
  );
  // `schema` prints JSON Schema itself, and `failure` is not a command.
  expect(documented).toEqual(
    new Set([...commands.filter((name) => name !== "schema"), "failure"])
  );
});
