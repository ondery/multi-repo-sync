import * as vscode from "vscode";
import { discardPaths } from "../git/actions";
import {
  FORCE_WITH_LEASE,
  type GitCommit,
  type GitRepository,
} from "../git/types";
import { detectDefaultBranch } from "../github/defaultBranch";
import { createPullRequest } from "../github/pullRequests";
import { githubRemote } from "../github/remote";
import { errorMessage } from "../util/error";
import { repoLabel } from "../util/path";
import type { OperationId } from "./catalog";
import { interpretCommitResult } from "./commitResult";
import type { RunSession } from "./session";

export interface StepOutcome {
  status: "ok" | "skipped" | "cancelled" | "failed";
  detail?: string;
  stopRun?: boolean;
  needsChoice?: boolean;
}

export async function executeOperation(
  id: OperationId,
  repo: GitRepository,
  session: RunSession,
  token: vscode.CancellationToken,
  peers: readonly GitRepository[],
): Promise<StepOutcome> {
  try {
    if (token.isCancellationRequested) {
      return { status: "cancelled", stopRun: true };
    }
    await repo.status();
    switch (id) {
      case "fetch":
        await repo.fetch();
        return { status: "ok" };
      case "pull":
        await repo.pull();
        return { status: "ok" };
      case "push":
        return push(repo, false);
      case "sync":
        await repo.pull();
        return push(repo, false);
      case "publishBranch":
        return publish(repo);
      case "stageAll":
        return stageAll(repo);
      case "commit":
        return commit(repo);
      case "stash":
        return stash(repo);
      case "stashPop":
        await repo.popStash();
        return { status: "ok" };
      case "checkout":
        return checkout(repo, session, token, peers);
      case "createBranch":
        return createBranch(repo, session, token);
      case "merge":
        return merge(repo, session, token, peers);
      case "rebase":
        return rebase(repo, session, token, peers);
      case "createTag":
        return createTag(repo, session, token);
      case "createPullRequest":
        return openPullRequest(repo, session, token);
      case "discardAll":
        return discardAll(repo);
      case "forcePushWithLease":
        return forcePush(repo);
      default:
        return { status: "failed", detail: id };
    }
  } catch (error) {
    return { status: "failed", detail: errorMessage(error) };
  }
}

async function stageAll(repo: GitRepository): Promise<StepOutcome> {
  const paths = uniquePaths([
    ...repo.state.workingTreeChanges,
    ...repo.state.untrackedChanges,
  ]);
  if (paths.length === 0) {
    return { status: "skipped", detail: vscode.l10n.t("No changes to stage.") };
  }
  await repo.add(paths);
  return { status: "ok" };
}

async function commit(repo: GitRepository): Promise<StepOutcome> {
  const before = repo.state.HEAD?.commit;
  const hadMessage = repo.inputBox.value.length > 0;
  const hadChanges = repositoryHasChanges(repo);
  // null disables the built-in post-commit sync or push so the pipeline keeps the next step.
  await vscode.commands.executeCommand("git.commit", repo.rootUri.fsPath, null);
  await repo.status().catch(() => undefined);
  const decision = interpretCommitResult({
    before,
    after: repo.state.HEAD?.commit,
    hadChanges,
  });
  if (decision === "ok") {
    return {
      status: "ok",
      detail: hadMessage
        ? vscode.l10n.t("Used the message from the Source Control input.")
        : undefined,
    };
  }
  if (decision === "skipped") {
    return {
      status: "skipped",
      detail: vscode.l10n.t("No changes to commit."),
    };
  }
  return { status: "cancelled", needsChoice: true };
}

async function push(
  repo: GitRepository,
  setUpstream: boolean,
): Promise<StepOutcome> {
  const head = repo.state.HEAD;
  if (!head?.name) {
    return { status: "skipped", detail: vscode.l10n.t("Detached HEAD.") };
  }
  const remote = head.upstream?.remote;
  if (remote && !setUpstream) {
    await repo.push(remote, head.name, false);
    return { status: "ok" };
  }
  await repo.push();
  return { status: "ok" };
}

async function publish(repo: GitRepository): Promise<StepOutcome> {
  const head = repo.state.HEAD;
  if (!head?.name) {
    return { status: "skipped", detail: vscode.l10n.t("Detached HEAD.") };
  }
  const remote =
    head.upstream?.remote ??
    githubRemote(repo.state.remotes)?.remote ??
    repo.state.remotes[0]?.name;
  if (!remote) {
    return { status: "failed", detail: vscode.l10n.t("No remote.") };
  }
  await repo.push(remote, head.name, true);
  return { status: "ok" };
}

async function stash(repo: GitRepository): Promise<StepOutcome> {
  if (!repositoryHasChanges(repo)) {
    return { status: "skipped", detail: vscode.l10n.t("No changes to stash.") };
  }
  await repo.createStash({ includeUntracked: true });
  return { status: "ok" };
}

async function checkout(
  repo: GitRepository,
  session: RunSession,
  token: vscode.CancellationToken,
  peers: readonly GitRepository[],
): Promise<StepOutcome> {
  const name = await session.once("checkout", () =>
    askBranch(vscode.l10n.t("Checkout branch"), peers, token),
  );
  if (!name) {
    return cancelledInput(token);
  }
  await repo.checkout(name);
  return { status: "ok" };
}

async function createBranch(
  repo: GitRepository,
  session: RunSession,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  const name = await session.once("createBranch", () =>
    askValidName(vscode.l10n.t("Create branch"), token),
  );
  if (!name) {
    return cancelledInput(token);
  }
  const heads = await repo.getRefs({ pattern: "refs/heads", count: 500 });
  if (heads.some((ref) => ref.name === name)) {
    return {
      status: "skipped",
      detail: vscode.l10n.t("Branch {0} already exists.", name),
    };
  }
  await repo.createBranch(name, true);
  return { status: "ok" };
}

async function merge(
  repo: GitRepository,
  session: RunSession,
  token: vscode.CancellationToken,
  peers: readonly GitRepository[],
): Promise<StepOutcome> {
  const name = await session.once("merge", () =>
    askBranch(vscode.l10n.t("Merge branch"), peers, token),
  );
  if (!name) {
    return cancelledInput(token);
  }
  try {
    await repo.merge(name);
  } catch (error) {
    if (repo.state.mergeChanges.length > 0) {
      return {
        status: "failed",
        detail: vscode.l10n.t("Merge conflicts need to be resolved."),
      };
    }
    throw error;
  }
  if (repo.state.mergeChanges.length > 0) {
    return {
      status: "failed",
      detail: vscode.l10n.t("Merge conflicts need to be resolved."),
    };
  }
  return { status: "ok" };
}

async function rebase(
  repo: GitRepository,
  session: RunSession,
  token: vscode.CancellationToken,
  peers: readonly GitRepository[],
): Promise<StepOutcome> {
  const name = await session.once("rebase", () =>
    askBranch(vscode.l10n.t("Rebase onto"), peers, token),
  );
  if (!name) {
    return cancelledInput(token);
  }
  try {
    await repo.rebase(name);
  } catch (error) {
    if (repo.state.rebaseCommit) {
      return {
        status: "failed",
        detail: vscode.l10n.t("Rebase conflicts need to be resolved."),
      };
    }
    throw error;
  }
  if (repo.state.rebaseCommit) {
    return {
      status: "failed",
      detail: vscode.l10n.t("Rebase conflicts need to be resolved."),
    };
  }
  return { status: "ok" };
}

async function createTag(
  repo: GitRepository,
  session: RunSession,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  const name = await session.once("tag", () =>
    askValidName(vscode.l10n.t("Tag name"), token),
  );
  if (!name) {
    return cancelledInput(token);
  }
  await repo.tag(name, name, repo.state.HEAD?.commit);
  return { status: "ok" };
}

async function openPullRequest(
  repo: GitRepository,
  session: RunSession,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  const parsed = githubRemote(repo.state.remotes);
  if (!parsed) {
    return { status: "skipped", detail: vscode.l10n.t("No GitHub remote.") };
  }
  const head = repo.state.HEAD;
  if (!head?.name) {
    return { status: "skipped", detail: vscode.l10n.t("Detached HEAD.") };
  }
  const base = await session.once("pr-base", async () => {
    const detected = await detectDefaultBranch(repo);
    return askValidName(
      vscode.l10n.t("Pull request base branch"),
      token,
      detected ?? "main",
      vscode.l10n.t("This base branch is used for every selected repository."),
    );
  });
  if (!base) {
    return cancelledInput(token);
  }
  if (head.name === base) {
    return {
      status: "skipped",
      detail: vscode.l10n.t("Already on the base branch."),
    };
  }
  const baseRef = await resolveBase(repo, parsed.remote, base);
  let commits: GitCommit[] = [];
  try {
    commits = await repo.log({ range: `${baseRef}..HEAD`, maxEntries: 20 });
  } catch (error) {
    return { status: "failed", detail: errorMessage(error) };
  }
  if (commits.length === 0) {
    return {
      status: "skipped",
      detail: vscode.l10n.t("No commits ahead of the base branch."),
    };
  }
  let auth: vscode.AuthenticationSession | undefined;
  try {
    auth = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: true,
    });
  } catch {
    return {
      status: "cancelled",
      stopRun: true,
      detail: vscode.l10n.t("GitHub sign-in was cancelled."),
    };
  }
  if (!auth) {
    return {
      status: "cancelled",
      stopRun: true,
      detail: vscode.l10n.t("GitHub sign-in was cancelled."),
    };
  }
  await repo.push(parsed.remote, head.name, !head.upstream);
  const subjects = commits
    .map((item) => item.message.split(/\r?\n/, 1)[0]?.trim())
    .filter((line): line is string => Boolean(line));
  const title = (subjects.length === 1 ? subjects[0] : head.name).slice(0, 120);
  const body = subjects
    .slice(0, 15)
    .map((line) => `- ${line}`)
    .join("\n");
  const pull = await createPullRequest({
    token: auth.accessToken,
    repo: parsed.repo,
    title,
    head: head.name,
    base,
    body,
  });
  return { status: "ok", detail: pull.url };
}

async function discardAll(repo: GitRepository): Promise<StepOutcome> {
  const pending = uniquePaths([
    ...repo.state.indexChanges,
    ...repo.state.workingTreeChanges,
    ...repo.state.untrackedChanges,
    ...repo.state.mergeChanges,
  ]);
  const inProgress =
    repo.state.mergeChanges.length > 0 || repo.state.rebaseCommit !== undefined;
  if (pending.length === 0 && !inProgress) {
    return {
      status: "skipped",
      detail: vscode.l10n.t("No changes to discard."),
    };
  }
  const action = vscode.l10n.t("Discard");
  const confirmed = await confirm(
    vscode.l10n.t(
      "Discard all changes in {0}? This cannot be undone.",
      repoLabel(repo.rootUri.fsPath),
    ),
    action,
  );
  if (!confirmed) {
    return { status: "skipped", detail: vscode.l10n.t("Discard declined.") };
  }
  if (repo.state.rebaseCommit) {
    await repo.rebaseAbort();
  }
  if (repo.state.mergeChanges.length > 0) {
    await repo.mergeAbort();
  }
  await repo.status();
  const paths = uniquePaths([
    ...repo.state.indexChanges,
    ...repo.state.workingTreeChanges,
    ...repo.state.untrackedChanges,
  ]);
  await discardPaths(repo, paths);
  return { status: "ok" };
}

async function forcePush(repo: GitRepository): Promise<StepOutcome> {
  const head = repo.state.HEAD;
  if (!head?.name) {
    return { status: "skipped", detail: vscode.l10n.t("Detached HEAD.") };
  }
  if (!head.upstream?.remote) {
    return {
      status: "failed",
      detail: vscode.l10n.t("The branch has no upstream."),
    };
  }
  const action = vscode.l10n.t("Force Push");
  const confirmed = await confirm(
    vscode.l10n.t(
      "Force push {0} with lease? This can overwrite remote history.",
      repoLabel(repo.rootUri.fsPath),
    ),
    action,
  );
  if (!confirmed) {
    return { status: "skipped", detail: vscode.l10n.t("Force push declined.") };
  }
  await repo.push(head.upstream.remote, head.name, false, FORCE_WITH_LEASE);
  return { status: "ok" };
}

function repositoryHasChanges(repo: GitRepository): boolean {
  const state = repo.state;
  return (
    state.indexChanges.length +
      state.workingTreeChanges.length +
      state.untrackedChanges.length +
      state.mergeChanges.length >
      0 || state.rebaseCommit !== undefined
  );
}

function uniquePaths(
  changes: readonly { uri: { fsPath: string } }[],
): string[] {
  return [
    ...new Set(changes.map((change) => change.uri.fsPath).filter(Boolean)),
  ];
}

function cancelledInput(token: vscode.CancellationToken): StepOutcome {
  if (token.isCancellationRequested) {
    return { status: "cancelled", stopRun: true };
  }
  return {
    status: "cancelled",
    stopRun: true,
    detail: vscode.l10n.t("Input was cancelled."),
  };
}

async function confirm(message: string, action: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    action,
  );
  return choice === action;
}

async function askBranch(
  title: string,
  peers: readonly GitRepository[],
  token: vscode.CancellationToken,
): Promise<string | undefined> {
  const names = await branchNames(peers);
  const typed = vscode.l10n.t("Enter a branch name…");
  if (names.length === 0) {
    return askValidName(title, token);
  }
  const picked = await vscode.window.showQuickPick(
    [typed, ...names],
    {
      title,
      ignoreFocusOut: true,
      placeHolder: title,
    },
    token,
  );
  if (!picked || token.isCancellationRequested) {
    return undefined;
  }
  if (picked === typed) {
    return askValidName(title, token);
  }
  return picked;
}

async function askValidName(
  title: string,
  token: vscode.CancellationToken,
  initial?: string,
  prompt?: string,
): Promise<string | undefined> {
  while (!token.isCancellationRequested) {
    const value = await vscode.window.showInputBox(
      {
        title,
        value: initial,
        ignoreFocusOut: true,
        prompt: prompt ?? title,
      },
      token,
    );
    if (value === undefined || token.isCancellationRequested) {
      return undefined;
    }
    if (validRefName(value)) {
      return value;
    }
    void vscode.window.showWarningMessage(
      vscode.l10n.t("Branch name is not valid."),
    );
  }
  return undefined;
}

async function branchNames(repos: readonly GitRepository[]): Promise<string[]> {
  const names = new Set<string>();
  await Promise.all(
    repos.map(async (repo) => {
      try {
        const refs = await repo.getRefs({ pattern: "refs/heads", count: 300 });
        for (const ref of refs) {
          if (ref.name && ref.name !== "HEAD") {
            names.add(ref.name);
          }
        }
      } catch {
        // A repository that cannot list refs still leaves the prompt usable.
      }
    }),
  );
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function resolveBase(
  repo: GitRepository,
  remote: string,
  base: string,
): Promise<string> {
  const heads = await repo
    .getRefs({ pattern: "refs/heads", count: 300 })
    .catch(() => []);
  if (heads.some((ref) => ref.name === base)) {
    return base;
  }
  const remotes = await repo
    .getRefs({ pattern: `refs/remotes/${remote}`, count: 300 })
    .catch(() => []);
  const qualified = `${remote}/${base}`;
  if (remotes.some((ref) => ref.name === qualified)) {
    return qualified;
  }
  return base;
}

function validRefName(name: string): boolean {
  if (
    !name ||
    name.trim() !== name ||
    name.endsWith(".lock") ||
    name.endsWith(".")
  ) {
    return false;
  }
  if (
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.includes("..") ||
    name.includes("@{") ||
    name.includes("//")
  ) {
    return false;
  }
  const forbidden = new Set([" ", "~", "^", ":", "?", "*", "[", "]", "\\"]);
  for (const char of name) {
    if (forbidden.has(char) || char.charCodeAt(0) < 32) {
      return false;
    }
  }
  return true;
}
