import * as vscode from "vscode";
import { isDestructive, type OperationId } from "./catalog";

const ICONS: Record<OperationId, string> = {
  fetch: "cloud-download",
  pull: "arrow-down",
  stageAll: "add",
  generateCommitMessage: "sparkle",
  commit: "check",
  push: "arrow-up",
  sync: "sync",
  publishBranch: "cloud-upload",
  stash: "archive",
  stashPop: "archive",
  checkout: "git-branch",
  createBranch: "git-branch",
  merge: "git-merge",
  rebase: "debug-restart",
  createTag: "tag",
  createPullRequest: "git-pull-request",
  discardAll: "discard",
  forcePushWithLease: "repo-force-push",
};

export function operationLabel(id: OperationId): string {
  const labels: Record<OperationId, string> = {
    fetch: vscode.l10n.t("Fetch"),
    pull: vscode.l10n.t("Pull"),
    stageAll: vscode.l10n.t("Stage All"),
    generateCommitMessage: vscode.l10n.t("Generate Commit Message"),
    commit: vscode.l10n.t("Commit"),
    push: vscode.l10n.t("Push"),
    sync: vscode.l10n.t("Sync"),
    publishBranch: vscode.l10n.t("Publish Branch"),
    stash: vscode.l10n.t("Stash"),
    stashPop: vscode.l10n.t("Pop Stash"),
    checkout: vscode.l10n.t("Checkout Branch"),
    createBranch: vscode.l10n.t("Create Branch"),
    merge: vscode.l10n.t("Merge"),
    rebase: vscode.l10n.t("Rebase"),
    createTag: vscode.l10n.t("Create Tag"),
    createPullRequest: vscode.l10n.t("Create Pull Request"),
    discardAll: vscode.l10n.t("Discard Changes"),
    forcePushWithLease: vscode.l10n.t("Force Push (With Lease)"),
  };
  return labels[id];
}

export function operationIconName(id: OperationId): string {
  return ICONS[id];
}

export function operationDescription(id: OperationId): string | undefined {
  if (isDestructive(id)) {
    return vscode.l10n.t("Destructive");
  }
  if (id === "sync") {
    return vscode.l10n.t("Pull, then push.");
  }
  if (id === "generateCommitMessage") {
    return vscode.l10n.t("Source Control");
  }
  return undefined;
}

export function operationTooltip(id: OperationId): string {
  switch (id) {
    case "stageAll":
      return vscode.l10n.t("Stages every change without asking.");
    case "generateCommitMessage":
      return vscode.l10n.t(
        "Runs Source Control's Generate Commit Message and waits until the message is ready.",
      );
    case "commit":
      return vscode.l10n.t(
        "Commits the staged changes with the message already prepared.",
      );
    case "sync":
      return vscode.l10n.t("Pull, then push.");
    case "discardAll":
      return vscode.l10n.t("Discards uncommitted changes after confirmation.");
    case "forcePushWithLease":
      return vscode.l10n.t("Force-pushes with lease after confirmation.");
    case "createPullRequest":
      return vscode.l10n.t(
        "Pushes the branch and opens a GitHub pull request.",
      );
    default:
      return operationLabel(id);
  }
}
