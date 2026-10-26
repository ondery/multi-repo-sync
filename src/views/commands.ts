import * as vscode from "vscode";
import {
  checkoutRef,
  discardPaths,
  openChange,
  openExternal,
} from "../git/actions";
import { detectDefaultBranch } from "../github/defaultBranch";
import {
  branchNameOnGitHub,
  githubBranchUrl,
  githubCommitUrl,
  githubCompareUrl,
  githubRemote,
  githubRepoUrl,
} from "../github/remote";
import type { OperationId } from "../pipeline/catalog";
import { executeOperation } from "../pipeline/execute";
import { operationLabel } from "../pipeline/labels";
import type { PipelineRunner } from "../pipeline/runner";
import { RunSession } from "../pipeline/session";
import type { RepoModel } from "../repos/model";
import type { ExtensionState } from "../state/store";
import { errorMessage } from "../util/error";
import type { RepositoryTree } from "./repositoryTree";
import type { TimelineView } from "./timelineView";
import {
  isRepoTreeNode,
  type BranchNode,
  type ChangeNode,
  type CommitNode,
  type GroupNode,
  type PullRequestNode,
} from "./nodes";

export interface ExtensionHost {
  model: RepoModel;
  store: ExtensionState;
  repositories: RepositoryTree;
  runner: PipelineRunner;
  timeline: TimelineView;
  updateBadge: () => void;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  host: ExtensionHost,
): void {
  const register = (id: string, callback: (...args: unknown[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));
  };

  register("multiRepoSync.start", () => host.runner.start());
  register("multiRepoSync.stop", () => host.runner.stop());
  register("multiRepoSync.refreshRepositories", () => refresh(host));
  register("multiRepoSync.selectAllRepositories", () => selectAll(host, true));
  register("multiRepoSync.clearRepositorySelection", () =>
    selectAll(host, false),
  );
  register("multiRepoSync.fetch", (node) => runOne(host, node, "fetch"));
  register("multiRepoSync.pull", (node) => runOne(host, node, "pull"));
  register("multiRepoSync.push", (node) => runOne(host, node, "push"));
  register("multiRepoSync.sync", (node) => runOne(host, node, "sync"));
  register("multiRepoSync.stageAll", (node) => runOne(host, node, "stageAll"));
  register("multiRepoSync.commit", (node) => runOne(host, node, "commit"));
  register("multiRepoSync.openOnGitHub", (node) => openRepo(host, node));
  register("multiRepoSync.openCompareOnGitHub", (node) =>
    openCompare(host, node),
  );
  register("multiRepoSync.revealInExplorer", (node) => reveal(node));
  register("multiRepoSync.openTerminal", (node) => openTerminal(host, node));
  register("multiRepoSync.copyPath", (node) => copyRoot(node));
  register("multiRepoSync.checkoutBranch", (node) =>
    checkoutBranch(host, node),
  );
  register("multiRepoSync.mergeBranch", (node) => mergeBranch(host, node));
  register("multiRepoSync.publishBranch", (node) => publishBranch(host, node));
  register("multiRepoSync.deleteBranch", (node) => deleteBranch(host, node));
  register("multiRepoSync.copyBranchName", (node) => copyBranch(node));
  register("multiRepoSync.openBranchOnGitHub", (node) =>
    openBranch(host, node),
  );
  register("multiRepoSync.openChange", (node) => openChangeNode(node));
  register("multiRepoSync.stageChange", (node) =>
    stageChange(host, node, true),
  );
  register("multiRepoSync.unstageChange", (node) =>
    stageChange(host, node, false),
  );
  register("multiRepoSync.discardChange", (node) => discardChange(host, node));
  register("multiRepoSync.copyCommitHash", (node) => copyCommit(node, "hash"));
  register("multiRepoSync.copyCommitMessage", (node) =>
    copyCommit(node, "message"),
  );
  register("multiRepoSync.checkoutCommit", (node) =>
    checkoutCommit(host, node),
  );
  register("multiRepoSync.openCommitOnGitHub", (node) =>
    openCommit(host, node),
  );
  register("multiRepoSync.openPullRequest", (node) => openPullRequest(node));
  register("multiRepoSync.checkoutPullRequest", (node) =>
    checkoutPullRequest(host, node),
  );
  register("multiRepoSync.refreshPullRequests", (node) =>
    refreshPullRequests(host, node),
  );
  register("multiRepoSync.signInGitHub", (node) => signIn(host, node));
}

async function refresh(host: ExtensionHost): Promise<void> {
  await Promise.all(
    host.model.list().map((repo) => repo.status().catch(() => undefined)),
  );
  host.repositories.invalidatePullRequests();
  host.timeline.refresh();
  host.updateBadge();
}

async function selectAll(
  host: ExtensionHost,
  selected: boolean,
): Promise<void> {
  const roots = selected
    ? host.model.list().map((repo) => repo.rootUri.fsPath)
    : [];
  await host.store.setSelectedRoots(roots);
  host.repositories.refresh(true);
  host.updateBadge();
}

async function runOne(
  host: ExtensionHost,
  value: unknown,
  id: OperationId,
): Promise<void> {
  const root = rootOf(value);
  const repo = root ? host.model.find(root) : undefined;
  if (!repo) {
    return;
  }
  const source = new vscode.CancellationTokenSource();
  try {
    const outcome = await executeOperation(
      id,
      repo,
      new RunSession(),
      source.token,
      [repo],
    );
    if (outcome.status === "failed") {
      void vscode.window.showErrorMessage(outcome.detail || operationLabel(id));
    }
  } finally {
    source.dispose();
  }
}

async function openRepo(host: ExtensionHost, value: unknown): Promise<void> {
  const repo = repoOf(host, value);
  const parsed = repo ? githubRemote(repo.state.remotes) : undefined;
  if (parsed) {
    await openExternal(githubRepoUrl(parsed.repo));
  }
}

async function openCompare(host: ExtensionHost, value: unknown): Promise<void> {
  const repo = repoOf(host, value);
  const parsed = repo ? githubRemote(repo.state.remotes) : undefined;
  if (!repo || !parsed) {
    return;
  }
  const head = repo.state.HEAD?.name;
  const base = head ? await detectDefaultBranch(repo) : undefined;
  if (head && base && head !== base) {
    await openExternal(githubCompareUrl(parsed.repo, base, head));
    return;
  }
  if (head) {
    await openExternal(githubBranchUrl(parsed.repo, head));
    return;
  }
  await openExternal(githubRepoUrl(parsed.repo));
}

async function reveal(value: unknown): Promise<void> {
  const root = rootOf(value);
  if (!root) {
    return;
  }
  await vscode.commands.executeCommand(
    "revealInExplorer",
    vscode.Uri.file(root),
  );
}

function openTerminal(host: ExtensionHost, value: unknown): void {
  const root = rootOf(value);
  if (!root) {
    return;
  }
  const terminal = vscode.window.createTerminal({
    name: host.model.label(root),
    cwd: root,
  });
  terminal.show();
}

async function copyRoot(value: unknown): Promise<void> {
  const root = rootOf(value);
  if (root) {
    await vscode.env.clipboard.writeText(root);
  }
}

async function checkoutBranch(
  host: ExtensionHost,
  value: unknown,
): Promise<void> {
  const node = branchOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  if (!node || !repo) {
    return;
  }
  await guard(() => checkoutRef(repo, node.name, node.remote));
}

async function mergeBranch(host: ExtensionHost, value: unknown): Promise<void> {
  const node = branchOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  if (!node || !repo) {
    return;
  }
  await guard(async () => {
    await repo.merge(node.name);
    if (repo.state.mergeChanges.length > 0) {
      throw new Error(vscode.l10n.t("Merge conflicts need to be resolved."));
    }
  });
}

async function publishBranch(
  host: ExtensionHost,
  value: unknown,
): Promise<void> {
  const node = branchOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  if (!node || !repo || node.remote) {
    return;
  }
  const remote =
    repo.state.HEAD?.upstream?.remote ??
    githubRemote(repo.state.remotes)?.remote ??
    repo.state.remotes[0]?.name;
  if (!remote) {
    void vscode.window.showErrorMessage(vscode.l10n.t("No remote."));
    return;
  }
  await guard(() => repo.push(remote, node.name, true));
}

async function deleteBranch(
  host: ExtensionHost,
  value: unknown,
): Promise<void> {
  const node = branchOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  if (!node || !repo || node.remote) {
    return;
  }
  if (node.current) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t("The current branch cannot be deleted."),
    );
    return;
  }
  const action = vscode.l10n.t("Delete");
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t("Delete branch {0}?", node.name),
    { modal: true },
    action,
  );
  if (choice !== action) {
    return;
  }
  await guard(() => repo.deleteBranch(node.name, false));
}

async function copyBranch(value: unknown): Promise<void> {
  const node = branchOf(value);
  if (node) {
    await vscode.env.clipboard.writeText(node.name);
  }
}

async function openBranch(host: ExtensionHost, value: unknown): Promise<void> {
  const node = branchOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  const parsed = repo ? githubRemote(repo.state.remotes) : undefined;
  if (!node || !parsed) {
    return;
  }
  await openExternal(
    githubBranchUrl(parsed.repo, branchNameOnGitHub(node.name, node.remote)),
  );
}

async function openChangeNode(value: unknown): Promise<void> {
  const node = changeOf(value);
  if (!node) {
    return;
  }
  await guard(() => openChange(node));
}

async function stageChange(
  host: ExtensionHost,
  value: unknown,
  stage: boolean,
): Promise<void> {
  const node = changeOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  if (!node || !repo) {
    return;
  }
  await guard(() =>
    stage ? repo.add([node.fsPath]) : repo.revert([node.fsPath]),
  );
}

async function discardChange(
  host: ExtensionHost,
  value: unknown,
): Promise<void> {
  const node = changeOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  if (!node || !repo) {
    return;
  }
  const action = vscode.l10n.t("Discard");
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t("Discard changes to {0}? This cannot be undone.", node.label),
    { modal: true },
    action,
  );
  if (choice !== action) {
    return;
  }
  await guard(() => discardPaths(repo, [node.fsPath]));
}

async function copyCommit(
  value: unknown,
  field: "hash" | "message",
): Promise<void> {
  const node = commitOf(value);
  if (node) {
    await vscode.env.clipboard.writeText(
      field === "hash" ? node.hash : node.message,
    );
  }
}

async function checkoutCommit(
  host: ExtensionHost,
  value: unknown,
): Promise<void> {
  const node = commitOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  if (!node || !repo) {
    return;
  }
  const action = vscode.l10n.t("Checkout");
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t("Check out {0}? This detaches HEAD.", node.hash.slice(0, 7)),
    { modal: true },
    action,
  );
  if (choice !== action) {
    return;
  }
  await guard(() => repo.checkout(node.hash));
}

async function openCommit(host: ExtensionHost, value: unknown): Promise<void> {
  const node = commitOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  const parsed = repo ? githubRemote(repo.state.remotes) : undefined;
  if (node && parsed) {
    await openExternal(githubCommitUrl(parsed.repo, node.hash));
  }
}

async function openPullRequest(value: unknown): Promise<void> {
  const node = pullOf(value);
  if (node) {
    await openExternal(node.url);
  }
}

async function checkoutPullRequest(
  host: ExtensionHost,
  value: unknown,
): Promise<void> {
  const node = pullOf(value);
  const repo = node ? host.model.find(node.root) : undefined;
  if (!node || !repo) {
    return;
  }
  await guard(async () => {
    try {
      await repo.checkout(node.head);
    } catch {
      await repo.fetch();
      await repo.checkout(node.head);
    }
  });
}

function refreshPullRequests(host: ExtensionHost, value: unknown): void {
  const node = groupOf(value);
  if (node?.group === "pullRequests") {
    host.repositories.invalidatePullRequests(node.root);
  }
}

async function signIn(host: ExtensionHost, value: unknown): Promise<void> {
  if (isRepoTreeNode(value) && value.kind === "auth") {
    try {
      await host.repositories.signIn(value.root);
    } catch (error) {
      void vscode.window.showErrorMessage(errorMessage(error));
    }
  }
}

function repoOf(host: ExtensionHost, value: unknown) {
  const root = rootOf(value);
  return root ? host.model.find(root) : undefined;
}

function rootOf(value: unknown): string | undefined {
  if (!isRepoTreeNode(value) || value.kind === "info") {
    return undefined;
  }
  return value.root;
}

function branchOf(value: unknown): BranchNode | undefined {
  return isRepoTreeNode(value) && value.kind === "branch" ? value : undefined;
}

function changeOf(value: unknown): ChangeNode | undefined {
  return isRepoTreeNode(value) && value.kind === "change" ? value : undefined;
}

function commitOf(value: unknown): CommitNode | undefined {
  return isRepoTreeNode(value) && value.kind === "commit" ? value : undefined;
}

function pullOf(value: unknown): PullRequestNode | undefined {
  return isRepoTreeNode(value) && value.kind === "pullRequest"
    ? value
    : undefined;
}

function groupOf(value: unknown): GroupNode | undefined {
  return isRepoTreeNode(value) && value.kind === "group" ? value : undefined;
}

async function guard(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    void vscode.window.showErrorMessage(errorMessage(error));
  }
}
