# Package API compatibility pilot

Adopt the neutral `typescript-api` pack to check direct imports of TypeScript's removed `Map` compiler API. TypeScript 5.0 removed that export. The pilot uses the compiler's `TS2305` diagnostic for `import type { Map as LegacyMap } from "typescript"`, including its module and member identity. An unrelated imported `Map` or a local namespace called `ts` keeps its ordinary meaning. [TypeScript API breaking changes](https://github.com/microsoft/TypeScript/wiki/API-Breaking-Changes#typescript-50)

```toml
pilot = 0
include = ["packages/**/*.ts"]
exclude = ["**/node_modules/**"]

[rules]
enabled = true
packs = ["typescript-api"]
```

Each package declares its supported TypeScript API range in its worktree `package.json` under `peerDependencies.typescript`. A range wholly below stable `5.0.0` makes the rule inapplicable. A range wholly at or above that version makes it applicable. A range spanning the boundary cannot establish one effective API target and yields an incomplete check. Explicit prerelease targets are unsupported by this stable-release proof and are incomplete.

The pilot requires selection by name, either in `rules.packs` or with `cinch rules adopt typescript-api --yes`. Initialization and unnamed bulk adoption leave this pack off. Discovery still shows it with `explicitOnly = true`.

```json
{
  "peerDependencies": {
    "typescript": "^5.0.0"
  }
}
```

A package can explicitly inherit the workspace's peer target by adding `"ropes": { "inheritTargets": ["typescript"] }` to its manifest. Declaring and inheriting the same target is ambiguous. A valid manifest without a peer target establishes known absence of this declared support policy. An absent or unreadable required manifest is unresolved. Unsupported values such as `catalog:` and `workspace:*` are incomplete. This pilot reads this manifest source only. It does not derive a resolved dependency from a lockfile or infer a support target from an executable.

`rope explain --json` records the support range, package scope, source file and key, source content digest, explicit inheritance source, condition, and applicability decision beside each selected path. `rope check` executes that same plan. Named excluded paths retain the exclusion reason. A disabled, unadopted, or known-inapplicable check requires neither the API dependency nor its engine. A required unresolved decision yields exit 2, including alongside blocking findings.

The installed Bun checker is independently held to its tool pin. Before checking, the adapter resolves the installed `typescript` API package from each selected source directory and requires its version to satisfy the source package's declared support range. A nearer dependency installation is checked on its own. Missing or mismatched API declarations are incomplete. A newer `tsc` executable on PATH changes neither the target nor the decision.

The compiler keeps its native diagnostic message, source range and severity. A recognized diagnostic has rule ID `typescript-api/removed-map` and `nativeRule = "TS2305"`. Existing enforcement settings can make this rule advisory. Diagnostics outside this narrow direct-import pilot remain visible and make its proof incomplete. In particular, namespace-import diagnostics are not assigned an identity from the alias name alone. `fix` checks this rule and performs no rewrite.

The first proof accepts the nearest plain JSON `tsconfig.json` with explicit `bundler`, `node16`, or `nodenext` module resolution. The pinned checker rejects legacy `node` and `node10` modes. Inherited compiler configs, project references, `noCheck = true`, and resolution overrides such as `paths`, `baseUrl`, custom conditions and module suffixes are incomplete. A TypeScript alias can otherwise redirect the import to another module while leaving the diagnostic's printed module name unchanged. These unsupported configs remain visible until the pilot can verify their resolved symbol identity.

Fix previews copy the exact related nested TypeScript installation into a fresh scratch destination. Source links are dereferenced and destinations that lead outside scratch are rejected before writing. Each copied dependency can be changed independently inside scratch.

Run `bun test packages/cli/tests/compatibility.test.ts packages/cli/tests/target-evidence.test.ts packages/cinch/tests/target-policy.test.ts` for the offline proof. The fixture commits its support manifests and uses the exact official TypeScript 4.9.5 and 5.0.4 declarations installed from the workspace lockfile. The same checker validates the unchanged direct import against both declarations before the package policy is applied. The tests also cover inheritance, missing and ambiguous evidence, exclusions, a newer PATH executable, incompatible API declarations and package/workspace selections.

The recorded manifest digest identifies the worktree bytes read by this operation. A protected CI consumer must bind that evidence and the result to its trusted revision and policy before qualification.
