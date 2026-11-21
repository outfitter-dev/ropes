import { createHash } from "node:crypto";

import { CleanupPolicySchema } from "../../contracts/cleanup.ts";
import type { CleanupRequest } from "../../contracts/cleanup.ts";
import {
  ancestor,
  exactCommit,
  gitBytes,
  gitText,
  treeEntries,
} from "./git.ts";
import type { Entry } from "./git.ts";

const hash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const CONTEXT = new Set([
  "rope.toml",
  "cinch.toml",
  "outfitter.toml",
  "mise.toml",
  "sgconfig.yml",
  "sgconfig.yaml",
  "package.json",
  "bun.lock",
]);
const contextOf = (entries: readonly Entry[]) =>
  entries
    .filter(({ file }) => CONTEXT.has(file.split("/").at(-1) ?? ""))
    .map(({ file, object }) => [file, object]);

export const cleanupInputs = async (request: CleanupRequest) => {
  const separator = request.policy.indexOf(":");
  const approved = request.policy.slice(0, separator);
  const file = request.policy.slice(separator + 1);
  if (
    separator !== 40 ||
    file === "" ||
    file.startsWith("/") ||
    file.split("/").some((part) => ["", ".", ".."].includes(part))
  ) {
    throw new Error(
      "Use --migration <full-approved-commit>:<root-relative-policy.json>."
    );
  }
  const [parent, candidate, commit] = await Promise.all([
    exactCommit(request.cwd, request.parent),
    exactCommit(request.cwd, request.candidate),
    exactCommit(request.cwd, approved),
  ]);
  const ancestry = await gitText(
    request.cwd,
    "rev-list",
    "--parents",
    "-n",
    "1",
    candidate
  );
  const parents = ancestry.trim().split(" ").slice(1);
  if (parents.length !== 1 || parents[0] !== parent) {
    throw new Error(
      "The explicit parent must be the candidate's sole actual Git parent. Supply a constructed integration candidate when reviewing against another target."
    );
  }
  await ancestor(request.cwd, commit, parent);
  const bytes = await gitBytes(request.cwd, "show", `${commit}:${file}`);
  const policy = CleanupPolicySchema.parse(
    JSON.parse(new TextDecoder().decode(bytes))
  );
  await exactCommit(request.cwd, policy.anchor);
  await ancestor(request.cwd, policy.anchor, commit);
  const chainText = await gitText(
    request.cwd,
    "rev-list",
    "--first-parent",
    "--parents",
    parent
  );
  const chain = chainText
    .trim()
    .split("\n")
    .map((line) => line.split(" "));
  const anchorIndex = chain.findIndex(
    ([revision]) => revision === policy.anchor
  );
  if (
    anchorIndex === -1 ||
    chain.slice(0, anchorIndex).some((line) => line.length !== 2)
  ) {
    throw new Error(
      "The first cleanup proof requires a linear first-parent history from the accepted anchor. Construct an explicit linear integration candidate."
    );
  }
  const history = chain
    .slice(1, anchorIndex)
    .map(([revision], index): [string, string] => {
      if (revision === undefined) {
        throw new Error("Missing history identity");
      }
      return [`history-${index}`, revision];
    });
  const identities = { anchor: policy.anchor, candidate, parent };
  const trees: {
    entries: Entry[];
    name: string;
    revision: string;
    tree: string;
  }[] = [];
  for (const [name, revision] of [...Object.entries(identities), ...history]) {
    // eslint-disable-next-line no-await-in-loop -- keep immutable Git reads bounded across history
    const entries = await treeEntries(request.cwd, revision);
    // eslint-disable-next-line no-await-in-loop -- each revision is read before materializing the next
    const tree = await gitText(request.cwd, "rev-parse", `${revision}^{tree}`);
    trees.push({ entries, name, revision, tree });
  }
  const approvedEntries = await treeEntries(request.cwd, commit);
  const context = JSON.stringify(contextOf(approvedEntries));
  for (const tree of trees) {
    if (JSON.stringify(contextOf(tree.entries)) !== context) {
      throw new Error(
        `${tree.name} changes configuration, package evidence, or pins relative to the approved policy. Review a new migration policy before changing coverage.`
      );
    }
  }
  const approvalIndex = chain.findIndex(([revision]) => revision === commit);
  if (approvalIndex === -1) {
    throw new Error(
      "The approved policy is not on the required first-parent lineage."
    );
  }
  const afterApproval = new Set([
    candidate,
    ...chain.slice(0, approvalIndex + 1).map(([revision]) => revision),
  ]);
  const approvedBlob = approvedEntries.find(
    (entry) => entry.file === file
  )?.object;
  if (
    trees.some(
      ({ entries, revision }) =>
        afterApproval.has(revision) &&
        entries.find((entry) => entry.file === file)?.object !== approvedBlob
    )
  ) {
    throw new Error(
      "A snapshot after approval rewrites or removes the approved migration policy."
    );
  }
  return {
    policy: { ...policy, commit, file, sha256: hash(bytes) },
    trees: trees.map((tree) => ({ ...tree, tree: tree.tree.trim() })),
  };
};
