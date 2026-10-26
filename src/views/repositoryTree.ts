import * as vscode from "vscode";
import type { GitChange, GitRepository } from "../git/types";
import {
  listOpenPullRequests,
  type GitHubPullRequest,
} from "../github/pullRequests";
import { githubRemote } from "../github/remote";
import { timelineLimit } from "../pipeline/settings";
import type { RepoModel } from "../repos/model";
import type { ExtensionState } from "../state/store";
import { errorMessage } from "../util/error";
import { normalizeKey, relativePath } from "../util/path";
import type {
  BranchNode,
  ChangeNode,
  CommitNode,
  GroupId,
  GroupNode,
  RepoTreeNode,
} from "./nodes";

const BRANCH_LIMIT = 200;

type PullCache =
  | { state: "ready"; items: GitHubPullRequest[] }
  | { state: "auth" }
  | { state: "error"; message: string };

export class RepositoryTree
  implements vscode.TreeDataProvider<RepoTreeNode>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<
    RepoTreeNode | undefined
  >();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly pulls = new Map<string, PullCache>();
  private readonly loadingPulls = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly model: RepoModel,
    private readonly store: ExtensionState,
  ) {}

  refresh(immediate = false): void {
    clearTimeout(this.timer);
    if (immediate) {
      this.emitter.fire(undefined);
      return;
    }
    this.timer = setTimeout(() => this.emitter.fire(undefined), 80);
  }

  invalidatePullRequests(root?: string): void {
    if (!root) {
      this.pulls.clear();
      this.refresh(true);
      return;
    }
    this.pulls.delete(normalizeKey(root));
    this.refresh(true);
  }

  async signIn(root: string): Promise<void> {
    await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: true,
    });
    this.invalidatePullRequests(root);
  }

  getTreeItem(element: RepoTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "repo":
        return this.repoItem(element.root);
      case "group":
        return this.groupItem(element);
      case "change":
        return this.changeItem(element);
      case "branch":
        return this.branchItem(element);
      case "commit":
        return this.commitItem(element);
      case "pullRequest":
        return this.pullRequestItem(element);
      case "info":
        return this.infoItem(element.id, element.text);
      case "auth":
        return this.authItem(element.root);
      default:
        return new vscode.TreeItem("");
    }
  }

  async getChildren(element?: RepoTreeNode): Promise<RepoTreeNode[]> {
    if (!element) {
      return this.model
        .list()
        .map((repo) => ({ kind: "repo", root: repo.rootUri.fsPath }));
    }
    if (element.kind === "repo") {
      return this.repoChildren(element.root);
    }
    if (element.kind !== "group") {
      return [];
    }
    const repo = this.model.find(element.root);
    if (!repo) {
      return [];
    }
    try {
      switch (element.group) {
        case "changes":
          return this.changeChildren(repo);
        case "localBranches":
          return this.branchChildren(repo, false);
        case "remoteBranches":
          return this.branchChildren(repo, true);
        case "pullRequests":
          return this.pullChildren(repo);
        case "commits":
          return this.commitChildren(repo);
        default:
          return [];
      }
    } catch (error) {
      return [this.info(element.root, element.group, errorMessage(error))];
    }
  }

  getParent(element: RepoTreeNode): RepoTreeNode | undefined {
    switch (element.kind) {
      case "repo":
      case "info":
        return undefined;
      case "group":
        return { kind: "repo", root: element.root };
      case "auth":
        return { kind: "group", root: element.root, group: "pullRequests" };
      case "change":
        return { kind: "group", root: element.root, group: "changes" };
      case "branch":
        return {
          kind: "group",
          root: element.root,
          group: element.remote ? "remoteBranches" : "localBranches",
        };
      case "commit":
        return { kind: "group", root: element.root, group: "commits" };
      case "pullRequest":
        return { kind: "group", root: element.root, group: "pullRequests" };
      default:
        return undefined;
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.emitter.dispose();
  }

  private repoChildren(root: string): RepoTreeNode[] {
    const repo = this.model.find(root);
    const groups: GroupId[] = ["changes", "localBranches", "remoteBranches"];
    if (repo && githubRemote(repo.state.remotes)) {
      groups.push("pullRequests");
    }
    groups.push("commits");
    return groups.map((group) => ({ kind: "group", root, group }));
  }

  private changeChildren(repo: GitRepository): RepoTreeNode[] {
    const nodes = [
      ...repo.state.indexChanges.map((change) =>
        this.toChange(repo, change, true, false),
      ),
      ...repo.state.workingTreeChanges.map((change) =>
        this.toChange(repo, change, false, false),
      ),
      ...repo.state.untrackedChanges.map((change) =>
        this.toChange(repo, change, false, true),
      ),
    ].filter((node): node is ChangeNode => node !== undefined);
    if (nodes.length === 0) {
      return [
        this.info(repo.rootUri.fsPath, "changes", vscode.l10n.t("No changes")),
      ];
    }
    return nodes.sort((a, b) => a.label.localeCompare(b.label));
  }

  private async branchChildren(
    repo: GitRepository,
    remote: boolean,
  ): Promise<RepoTreeNode[]> {
    const pattern = remote ? "refs/remotes" : "refs/heads";
    const refs = await repo.getRefs({ pattern, count: BRANCH_LIMIT + 1 });
    const current = repo.state.HEAD?.name;
    const github = Boolean(githubRemote(repo.state.remotes));
    const nodes: BranchNode[] = refs
      .filter(
        (ref) => ref.name && ref.name !== "HEAD" && !ref.name.endsWith("/HEAD"),
      )
      .slice(0, BRANCH_LIMIT)
      .map(
        (ref): BranchNode => ({
          kind: "branch",
          root: repo.rootUri.fsPath,
          name: ref.name ?? "",
          remote,
          current: !remote && ref.name === current,
          github,
        }),
      )
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) || a.name.localeCompare(b.name),
      );
    if (nodes.length === 0) {
      const text = remote
        ? vscode.l10n.t("No remote branches")
        : vscode.l10n.t("No local branches");
      return [
        this.info(
          repo.rootUri.fsPath,
          remote ? "remoteBranches" : "localBranches",
          text,
        ),
      ];
    }
    const extra =
      refs.length > BRANCH_LIMIT
        ? [
            this.info(
              repo.rootUri.fsPath,
              remote ? "remoteBranches" : "localBranches",
              vscode.l10n.t("More branches are hidden."),
            ),
          ]
        : [];
    return [...nodes, ...extra];
  }

  private async commitChildren(repo: GitRepository): Promise<RepoTreeNode[]> {
    let commits: Awaited<ReturnType<GitRepository["log"]>> = [];
    try {
      commits = await repo.log({ maxEntries: timelineLimit() });
    } catch (error) {
      return [this.info(repo.rootUri.fsPath, "commits", errorMessage(error))];
    }
    if (commits.length === 0) {
      return [
        this.info(repo.rootUri.fsPath, "commits", vscode.l10n.t("No commits")),
      ];
    }
    const github = Boolean(githubRemote(repo.state.remotes));
    return commits.map((commit) => ({
      kind: "commit" as const,
      root: repo.rootUri.fsPath,
      hash: commit.hash,
      subject: subjectOf(commit.message),
      message: commit.message,
      github,
    }));
  }

  private pullChildren(repo: GitRepository): RepoTreeNode[] {
    const key = normalizeKey(repo.rootUri.fsPath);
    const cached = this.pulls.get(key);
    if (!cached) {
      this.loadPulls(repo);
      return [
        this.info(
          repo.rootUri.fsPath,
          "pullRequests",
          vscode.l10n.t("Loading pull requests…"),
        ),
      ];
    }
    if (cached.state === "auth") {
      return [{ kind: "auth", root: repo.rootUri.fsPath }];
    }
    if (cached.state === "error") {
      return [this.info(repo.rootUri.fsPath, "pullRequests", cached.message)];
    }
    if (cached.items.length === 0) {
      return [
        this.info(
          repo.rootUri.fsPath,
          "pullRequests",
          vscode.l10n.t("No pull requests"),
        ),
      ];
    }
    return cached.items.map((item) => ({
      kind: "pullRequest" as const,
      root: repo.rootUri.fsPath,
      number: item.number,
      title: item.title,
      url: item.url,
      head: item.head,
    }));
  }

  private loadPulls(repo: GitRepository): void {
    const key = normalizeKey(repo.rootUri.fsPath);
    if (this.pulls.has(key) || this.loadingPulls.has(key)) {
      return;
    }
    this.loadingPulls.add(key);
    void this.fetchPulls(repo)
      .catch((error) => {
        this.pulls.set(key, { state: "error", message: errorMessage(error) });
      })
      .finally(() => {
        this.loadingPulls.delete(key);
        this.refresh(true);
      });
  }

  private async fetchPulls(repo: GitRepository): Promise<void> {
    const key = normalizeKey(repo.rootUri.fsPath);
    const parsed = githubRemote(repo.state.remotes);
    if (!parsed) {
      this.pulls.set(key, {
        state: "error",
        message: vscode.l10n.t("No GitHub remote."),
      });
      return;
    }
    const auth = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: false,
    });
    if (!auth) {
      this.pulls.set(key, { state: "auth" });
      return;
    }
    const items = await listOpenPullRequests(auth.accessToken, parsed.repo);
    this.pulls.set(key, { state: "ready", items });
  }

  private repoItem(root: string): vscode.TreeItem {
    const repo = this.model.find(root);
    const item = new vscode.TreeItem(
      this.model.label(root),
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = `repo:${normalizeKey(root)}`;
    item.tooltip = root;
    item.description = repo ? describeRepo(repo) : "";
    const github = Boolean(repo && githubRemote(repo.state.remotes));
    const dirty = repo ? dirtyCount(repo) > 0 : false;
    item.iconPath = new vscode.ThemeIcon(
      dirty ? "source-control" : github ? "github" : "repo",
    );
    item.contextValue = github ? "repo.github" : "repo";
    item.checkboxState = this.store.isSelected(root)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    return item;
  }

  private groupItem(element: GroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      groupLabel(element.group),
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = `group:${normalizeKey(element.root)}:${element.group}`;
    item.contextValue =
      element.group === "pullRequests" ? "pullRequestGroup" : "group";
    item.iconPath = new vscode.ThemeIcon(groupIcon(element.group));
    return item;
  }

  private changeItem(element: ChangeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.id = `change:${normalizeKey(element.root)}:${element.staged ? "s" : "w"}:${element.fsPath}`;
    item.description = statusLabel(
      element.status,
      element.staged,
      element.untracked,
    );
    item.contextValue = element.staged ? "change.staged" : "change";
    item.resourceUri = vscode.Uri.file(element.fsPath);
    item.iconPath = vscode.ThemeIcon.File;
    item.command = {
      command: "multiRepoSync.openChange",
      title: vscode.l10n.t("Open Change"),
      arguments: [element],
    };
    return item;
  }

  private branchItem(element: BranchNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name);
    item.id = `branch:${normalizeKey(element.root)}:${element.remote ? "r" : "l"}:${element.name}`;
    item.iconPath = new vscode.ThemeIcon(
      element.remote ? "cloud" : "git-branch",
    );
    item.description = element.current ? vscode.l10n.t("current") : undefined;
    item.contextValue = branchContext(element);
    return item;
  }

  private commitItem(element: CommitNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.subject || element.hash.slice(0, 7),
    );
    item.id = `commit:${normalizeKey(element.root)}:${element.hash}`;
    item.description = element.hash.slice(0, 7);
    item.tooltip = `${element.hash}\n${element.subject}`;
    item.iconPath = new vscode.ThemeIcon("git-commit");
    item.contextValue = element.github ? "commit.github" : "commit";
    return item;
  }

  private pullRequestItem(
    element: RepoTreeNode & { kind: "pullRequest" },
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(`#${element.number} ${element.title}`);
    item.id = `pr:${normalizeKey(element.root)}:${element.number}`;
    item.description = element.head;
    item.tooltip = element.url;
    item.iconPath = new vscode.ThemeIcon("git-pull-request");
    item.contextValue = "pullRequest";
    item.command = {
      command: "multiRepoSync.openPullRequest",
      title: vscode.l10n.t("Open Pull Request"),
      arguments: [element],
    };
    return item;
  }

  private authItem(root: string): vscode.TreeItem {
    const item = new vscode.TreeItem(vscode.l10n.t("Sign in to GitHub"));
    item.id = `auth:${normalizeKey(root)}`;
    item.contextValue = "auth";
    item.iconPath = new vscode.ThemeIcon("github");
    item.command = {
      command: "multiRepoSync.signInGitHub",
      title: vscode.l10n.t("Sign in to GitHub"),
      arguments: [{ kind: "auth", root }],
    };
    return item;
  }

  private infoItem(id: string, text: string): vscode.TreeItem {
    const item = new vscode.TreeItem(text);
    item.id = id;
    item.contextValue = "info";
    item.iconPath = new vscode.ThemeIcon("info");
    return item;
  }

  private info(root: string, group: string, text: string): RepoTreeNode {
    return {
      kind: "info",
      id: `info:${normalizeKey(root)}:${group}:${text}`,
      text,
    };
  }

  private toChange(
    repo: GitRepository,
    change: GitChange,
    staged: boolean,
    untracked: boolean,
  ): ChangeNode | undefined {
    const fsPath = change.uri.fsPath;
    if (!fsPath) {
      return undefined;
    }
    return {
      kind: "change",
      root: repo.rootUri.fsPath,
      fsPath,
      originalUri: untracked ? undefined : change.originalUri.toString(),
      staged,
      untracked,
      status: change.status,
      label: relativePath(repo.rootUri.fsPath, fsPath),
    };
  }
}

function describeRepo(repo: GitRepository): string {
  const head = repo.state.HEAD;
  const parts: string[] = [];
  if (!head?.name) {
    parts.push(
      head?.commit ? `detached ${head.commit.slice(0, 7)}` : "detached",
    );
  } else {
    parts.push(head.name);
    if ((head.ahead ?? 0) > 0) {
      parts.push(`↑${head.ahead}`);
    }
    if ((head.behind ?? 0) > 0) {
      parts.push(`↓${head.behind}`);
    }
  }
  const dirty = dirtyCount(repo);
  if (dirty > 0) {
    parts.push(`• ${dirty}`);
  }
  return parts.join(" ");
}

function dirtyCount(repo: GitRepository): number {
  return (
    repo.state.indexChanges.length +
    repo.state.workingTreeChanges.length +
    repo.state.untrackedChanges.length
  );
}

function groupLabel(group: GroupId): string {
  switch (group) {
    case "changes":
      return vscode.l10n.t("Changes");
    case "localBranches":
      return vscode.l10n.t("Local Branches");
    case "remoteBranches":
      return vscode.l10n.t("Remote Branches");
    case "pullRequests":
      return vscode.l10n.t("Pull Requests");
    case "commits":
      return vscode.l10n.t("Recent Commits");
    default:
      return group;
  }
}

function groupIcon(group: GroupId): string {
  switch (group) {
    case "changes":
      return "diff";
    case "localBranches":
      return "git-branch";
    case "remoteBranches":
      return "cloud";
    case "pullRequests":
      return "git-pull-request";
    case "commits":
      return "history";
    default:
      return "folder";
  }
}

function branchContext(node: BranchNode): string {
  if (node.remote) {
    return node.github ? "remote-branch.github" : "remote-branch";
  }
  const base = node.current ? "branch.current" : "branch";
  return node.github ? `${base}.github` : base;
}

function statusLabel(
  status: number,
  staged: boolean,
  untracked: boolean,
): string {
  if (untracked || status === 7) {
    return vscode.l10n.t("Untracked");
  }
  if (
    status === 2 ||
    status === 6 ||
    status === 14 ||
    status === 15 ||
    status === 17
  ) {
    return vscode.l10n.t("Deleted");
  }
  if (
    status === 1 ||
    status === 9 ||
    status === 12 ||
    status === 13 ||
    status === 16
  ) {
    return vscode.l10n.t("Added");
  }
  if (status === 3 || status === 10) {
    return vscode.l10n.t("Renamed");
  }
  if (staged) {
    return vscode.l10n.t("Staged");
  }
  return vscode.l10n.t("Modified");
}

function subjectOf(message: string): string {
  return message.split(/\r?\n/, 1)[0]?.trim() || message;
}
