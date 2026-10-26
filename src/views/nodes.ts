export type GroupId =
  | "changes"
  | "localBranches"
  | "remoteBranches"
  | "pullRequests"
  | "commits";

export interface RepoNode {
  kind: "repo";
  root: string;
}

export interface GroupNode {
  kind: "group";
  root: string;
  group: GroupId;
}

export interface ChangeNode {
  kind: "change";
  root: string;
  fsPath: string;
  originalUri?: string;
  staged: boolean;
  untracked: boolean;
  status: number;
  label: string;
}

export interface BranchNode {
  kind: "branch";
  root: string;
  name: string;
  remote: boolean;
  current: boolean;
  github: boolean;
}

export interface CommitNode {
  kind: "commit";
  root: string;
  hash: string;
  subject: string;
  message: string;
  github: boolean;
}

export interface PullRequestNode {
  kind: "pullRequest";
  root: string;
  number: number;
  title: string;
  url: string;
  head: string;
}

export interface InfoNode {
  kind: "info";
  id: string;
  text: string;
}

export interface AuthNode {
  kind: "auth";
  root: string;
}

export type RepoTreeNode =
  | RepoNode
  | GroupNode
  | ChangeNode
  | BranchNode
  | CommitNode
  | PullRequestNode
  | InfoNode
  | AuthNode;

export function isRepoTreeNode(value: unknown): value is RepoTreeNode {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    value !== null &&
    "kind" in value
  );
}
