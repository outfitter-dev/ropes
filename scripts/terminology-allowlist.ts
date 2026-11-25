import docs from "./terminology-docs.json" with { type: "json" };
import runtime from "./terminology-runtime.json" with { type: "json" };
import tests from "./terminology-tests.json" with { type: "json" };

interface Exception {
  readonly reason: string;
  readonly lines: readonly string[];
}

export const exceptions: Readonly<Record<string, Exception>> = {
  ...docs,
  ...runtime,
  ...tests,
};

/** Only these registries quote approved lines without recursive allowances. */
export const registryFiles = [
  "scripts/terminology-docs.json",
  "scripts/terminology-runtime.json",
  "scripts/terminology-tests.json",
];
