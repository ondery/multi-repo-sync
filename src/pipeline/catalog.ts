export const OPERATION_IDS = [
  "fetch",
  "pull",
  "stageAll",
  "generateCommitMessage",
  "commit",
  "push",
  "sync",
  "publishBranch",
  "stash",
  "stashPop",
  "checkout",
  "createBranch",
  "merge",
  "rebase",
  "createTag",
  "createPullRequest",
  "discardAll",
  "forcePushWithLease",
] as const;

export type OperationId = (typeof OPERATION_IDS)[number];

const DESTRUCTIVE: ReadonlySet<string> = new Set([
  "discardAll",
  "forcePushWithLease",
]);

export function isOperationId(value: string): value is OperationId {
  return (OPERATION_IDS as readonly string[]).includes(value);
}

export function isDestructive(id: OperationId): boolean {
  return DESTRUCTIVE.has(id);
}
