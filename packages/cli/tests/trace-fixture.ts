export const PATHS = [
  "src/a file.ts",
  "src/clean.ts",
  "legacy/old.ts",
  "excluded/old.ts",
];

const PRIVATE = 'import { PrivateType } from "./private/types";\n';
const PUBLIC = 'import { PrivateType } from "./index";\n';

export const RATIONALE =
  "Use the public entry point so consumers share the supported export boundary.";

export const RULE = `id: private-import
language: typescript
severity: error
message: Import PrivateType through the public entry point.
metadata:
  rationale: ${RATIONALE}
  examples:
    valid: '${PUBLIC.trim()}'
    invalid: '${PRIVATE.trim()}'
rule:
  pattern: import { $NAME } from "./private/types"
`;

export const FILES: Readonly<Record<string, string>> = {
  "excluded/old.ts": PRIVATE,
  "legacy/old.ts": PRIVATE,
  "rope.toml": `pilot = 0
include = ["**/*.ts"]
exclude = ["excluded/**"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[rules]
enabled = true
local = ["rules"]
[[overrides]]
paths = ["legacy/**"]
[overrides.rules]
enabled = false
`,
  "rules/private-import.yml": RULE,
  "src/a file.ts": PRIVATE,
  "src/clean.ts": PUBLIC,
};
