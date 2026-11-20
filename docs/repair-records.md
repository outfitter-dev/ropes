# Offline repair pilot

The private-import fixture records two real lint and typecheck attempts. The first replaces a private import with the public entry point while its type export is missing. The second adds the export and reruns the same checks. Run `bun test packages/cli/tests/repair.test.ts` with the pinned engines to replay the proof.

The opt-in fixture hook follows Claude Code's documented `PostToolUse` command contract for `Edit|Write`. It reads the event on stdin and uses `cwd`, `session_id`, and `tool_use_id`. The automated proof invokes that contract directly. It does not launch a live Claude session. [Claude Code hooks reference](https://code.claude.com/docs/en/hooks#posttooluse)

To try the hook in a disposable copy of the trace fixture, save the initial `rope check --json` result outside the checkout. Set `ROPES_REPAIR_BASELINE` to that file and `ROPES_REPAIR_DIR` to a separate outside record directory. Add this entry to that fixture's `.claude/settings.json`, replacing the script path with the absolute path to this checkout's `packages/cli/tests/repair-hook.ts`.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bun /absolute/path/to/repair-hook.ts"
          }
        ]
      }
    ]
  }
}
```

Each record contains the original diagnostic and current versioned result, scope, observed engine versions, policy and rule hashes, authored guidance, Git base revision, tracked fixture baseline files, and the working diff. The fixture opts into retaining that source patch. A stable repository/session/event identity deduplicates retries. Atomic record creation preserves the first observation. New record directories use mode `0700` and record files use `0600`. Storage rejects paths inside the version-control checkout, including external symlink aliases, before creating a directory. The hook prints the check result and returns its exit code even when evidence storage fails.

`readRepairs(directory)` reads and validates these records offline. The fixture reader prints the recommendation separately from observed attempts, findings, patches, and verification inputs. The acceptance test removes the original fixture checkout, rebuilds both attempts from the saved baseline files and patches, and verifies their findings with the pinned engines. It then starts the reader with no engines on PATH. No transcript or upload is part of the record.
