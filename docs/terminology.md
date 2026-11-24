# Terminology guard

`bun run terminology:guard` scans tracked paths and tracked text for the retired product name. The repository check runs it after the workflow gate and before `rope check` and the tests. New files must be tracked to enter this gate.

Historical references and compatibility fixtures are recorded in three registries under `scripts/`:

- `terminology-docs.json` holds migration guidance and dated inventories.
- `terminology-runtime.json` holds recognition of retired input, historical fingerprints, packed proofs, and the guard's own search string.
- `terminology-tests.json` holds explicit compatibility fixtures and negative assertions.

Each entry names one repository-relative path, explains why its references remain, and lists the exact approved source lines. Repeated lines require repeated entries. Only the three registry files themselves are exempt from text scanning, because they quote the approved lines. Tracked paths always remain subject to the name check.

## Update an existing allowance

Run the guard after changing a file. A new match fails, and an approved line that is no longer present also fails. This prevents an old allowance from quietly authorizing a later reintroduction.

1. Locate the path and exact line in the appropriate registry.
2. Confirm that the changed text still serves the recorded historical or compatibility purpose. Preserve that reason when only wording or indentation changed.
3. Replace that one approved line with the exact new source line. If the reference was removed, delete its line allowance. Remove the path entry when it has no remaining allowances.
4. Run `bun run terminology:guard` against the complete checkout and `bun test scripts/terminology-guard.test.ts`.

An unrelated occurrence needs its own reviewed reason. Do not regenerate the registries from all current matches or exempt an entire guide. Current setup instructions in a guide remain checked even when that guide also contains a dated inventory.

## Replay a dependent change

Apply the reviewed registry change before revalidating lower-layer source or fixture edits. If those edits changed an approved line, update only the named old-to-new line using the procedure above. Retain the entry's original reason and review the registry diff with the source diff. A missing or duplicated old line is a conflict to inspect, rather than a reason to collect every current match. The full-checkout guard must pass after replay; a smaller fixture repository uses its own dedicated registry.
