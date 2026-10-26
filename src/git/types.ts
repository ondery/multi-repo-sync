import type { Event, Uri } from "vscode";

export const RefType = {
  Head: 0,
  RemoteHead: 1,
  Tag: 2,
} as const;

/** Matches the built-in Git extension's ForcePushMode.ForceWithLease. */
export const FORCE_WITH_LEASE = 1;

export interface GitRef {
  type: number;
  name?: string;
  commit?: string;
  remote?: string;
}

export interface GitUpstream {
  remote: string;
  name: string;
}

export interface GitBranch extends GitRef {
  upstream?: GitUpstream;
  ahead?: number;
  behind?: number;
}

export interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
  isReadOnly?: boolean;
}

export interface GitChange {
  uri: Uri;
  originalUri: Uri;
  renameUri?: Uri;
  status: number;
}

export interface GitCommit {
  hash: string;
  message: string;
  parents: string[];
  authorDate?: Date;
  authorName?: string;
  authorEmail?: string;
  commitDate?: Date;
}

export interface GitRepositoryState {
  HEAD: GitBranch | undefined;
  remotes: GitRemote[];
  mergeChanges: GitChange[];
  indexChanges: GitChange[];
  workingTreeChanges: GitChange[];
  untrackedChanges: GitChange[];
  rebaseCommit?: GitCommit;
  onDidChange: Event<void>;
}

export interface GitInputBox {
  value: string;
}

export interface GitLogOptions {
  maxEntries?: number;
  range?: string;
}

export interface GitRepository {
  rootUri: Uri;
  inputBox: GitInputBox;
  state: GitRepositoryState;
  status(): Promise<void>;
  log(options?: GitLogOptions): Promise<GitCommit[]>;
  getRefs(query: { pattern?: string; count?: number }): Promise<GitRef[]>;
  getBranch(name: string): Promise<GitBranch>;
  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  commit(
    message: string,
    options?: { all?: boolean | "tracked" },
  ): Promise<void>;
  clean(paths: string[]): Promise<void>;
  checkout(treeish: string): Promise<void>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;
  fetch(remote?: string): Promise<void>;
  pull(unshallow?: boolean): Promise<void>;
  push(
    remoteName?: string,
    branchName?: string,
    setUpstream?: boolean,
    force?: number,
  ): Promise<void>;
  merge(ref: string): Promise<void>;
  mergeAbort(): Promise<void>;
  rebase(branch: string): Promise<void>;
  rebaseAbort(): Promise<void>;
  createStash(options?: {
    message?: string;
    includeUntracked?: boolean;
    staged?: boolean;
  }): Promise<void>;
  popStash(index?: number): Promise<void>;
  tag(name: string, message: string, ref?: string): Promise<void>;
}

export type GitApiState = "uninitialized" | "initialized";

export interface GitApi {
  readonly git: { readonly path: string };
  state: GitApiState;
  onDidChangeState: Event<GitApiState>;
  repositories: GitRepository[];
  onDidOpenRepository: Event<GitRepository>;
  onDidCloseRepository: Event<GitRepository>;
}

export interface GitExtension {
  enabled: boolean;
  onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): GitApi;
}
