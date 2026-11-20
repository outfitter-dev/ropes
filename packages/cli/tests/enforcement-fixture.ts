export const RULE = "config/tsconfig-extends";
export const ADVISORY = "packages/advisory/tsconfig.json";
export const BLOCKING = "packages/blocking/tsconfig.json";
export const PATHS = [ADVISORY, BLOCKING];

export const BASE = `pilot = 0
include = ["**/tsconfig.json"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[rules]
enabled = true
packs = ["config"]
`;

export const TRY_RULE = `${BASE}
[rules.enforcement]
"${RULE}" = "advisory"
`;

export const MIXED = `${TRY_RULE}
[[overrides]]
paths = ["packages/blocking/**"]
[overrides.rules.enforcement]
"${RULE}" = "blocking"
`;
