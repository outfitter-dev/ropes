# Selecting files

`explain`, `check` and `fix` take the same paths and turn them into the same list of files. This is provisional, like the plan it feeds.

## What you can pass

| You pass    | Cinch looks at                                  |
| ----------- | ----------------------------------------------- |
| Nothing     | The whole workspace: every file under the root. |
| A directory | Every file under that directory.                |
| A file      | That file.                                      |

A relative path is read from the directory you ran the command in, so `cinch check .` inside `docs/` covers `docs/`. Run with no paths, Cinch covers the whole root wherever you started. The root is the nearest directory that configures Cinch, or the repository root when none does.

A path that does not exist, or that sits outside the root, ends the run with exit code 2. Cinch does not skip it quietly.

## Which files a directory brings in

When Cinch expands a directory or the workspace, it keeps a file only if all of these hold:

- Git would let you commit it. Tracked files and new untracked files count. Files that an ignore rule covers do not, and neither does a tracked file you have deleted.
- The config includes it and does not exclude it.

When git cannot answer, for example in a jj workspace with no git directory, Cinch walks the tree itself. It then skips `.git`, `.jj` and `node_modules`, and ignore rules do not apply.

## A file you name is always shown

A file you pass by name stays in the plan even when an ignore rule or the config leaves it out. Nothing runs on a file the config leaves out, and `cinch explain` says which setting decided that:

```text
vendor/c.md
  left out: excluded (cinch.toml: exclude)
```

## When nothing is selected

A selection that ends up with no files is clean and exits 0. The output says that nothing ran.
