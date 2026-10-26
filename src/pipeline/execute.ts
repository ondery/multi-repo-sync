import * as vscode from "vscode";
import { discardPaths } from "../git/actions";
import { gitExecutable, runGit } from "../git/run";
import type { GitCommit, GitRepository } from "../git/types";
import { detectDefaultBranch } from "../github/defaultBranch";
import { createPullRequest } from "../github/pullRequests";
import { githubRemote } from "../github/remote";
import { errorMessage } from "../util/error";
import { repoLabel } from "../util/path";
import type { OperationId } from "./catalog";
import { interpretCommitResult } from "./commitResult";
import {
  commitArgs,
  fetchArgs,
  pullArgs,
  pushArgs,
  rebaseAbortArgs,
  rebaseArgs,
  stashArgs,
  stashPopArgs,
  syncArgs,
} from "./gitArgs";
import { generateCommitMessage } from "../views/stageReview";
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
        return fetchRemote(repo, token);
      case "pull":
        return pull(repo, token);
      case "push":
        return push(repo, token);
      case "sync":
        return sync(repo, token);
      case "publishBranch":
        return publish(repo, token);
      case "stageAll":
        return stageAll(repo);
      case "generateCommitMessage":
        return generateMessage(repo, token);
      case "commit":
        return commit(repo, token);
      case "stash":
        return stash(repo, token);
      case "stashPop":
        return stashPop(repo, token);
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
        return forcePush(repo, token);
      default:
        return { status: "failed", detail: id };
    }
  } catch (error) {
    if (token.isCancellationRequested) {
      return {
        status: "cancelled",
        stopRun: true,
        detail: vscode.l10n.t("Run cancelled."),
      };
    }
    return { status: "failed", detail: errorMessage(error) };
  }
}

async function git(
  repo: GitRepository,
  args: readonly string[],
  token?: vscode.CancellationToken,
): Promise<void> {
  await runGit(repo.rootUri.fsPath, await gitExecutable(), args, token);
  await repo.status();
}

async function stageAll(repo: GitRepository): Promise<StepOutcome> {
  const paths = uniquePaths([
    ...repo.state.workingTreeChanges,
    ...repo.state.untrackedChanges,
  ]);
  if (paths.length === 0) {
    if (repo.state.indexChanges.length > 0) {
      return { status: "ok", detail: vscode.l10n.t("Already staged.") };
    }
    return { status: "skipped", detail: vscode.l10n.t("No changes to stage.") };
  }
  await repo.add(paths);
  return { status: "ok" };
}

async function generateMessage(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  if (!repositoryHasChanges(repo)) {
    return {
      status: "skipped",
      detail: vscode.l10n.t("No changes to describe."),
    };
  }
  const generated = await generateCommitMessage(repo);
  if (token.isCancellationRequested) {
    return { status: "cancelled", stopRun: true };
  }
  if (!generated) {
    return {
      status: "failed",
      detail: vscode.l10n.t(
        "Generate Commit Message is not available in this editor.",
      ),
    };
  }
  const ready = await waitForCommitMessage(repo, token);
  if (token.isCancellationRequested) {
    return { status: "cancelled", stopRun: true };
  }
  if (!ready) {
    return {
      status: "failed",
      detail: vscode.l10n.t("Commit message was not generated."),
    };
  }
  return {
    status: "ok",
    detail: vscode.l10n.t("Generated the commit message."),
  };
}

function waitForCommitMessage(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<boolean> {
  if (repo.inputBox.value.trim()) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (token.isCancellationRequested || repo.inputBox.value.trim()) {
        clearInterval(timer);
        resolve(repo.inputBox.value.trim().length > 0);
        return;
      }
      if (Date.now() - started > 60000) {
        clearInterval(timer);
        resolve(false);
      }
    }, 300);
  });
}

async function commit(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  const message = repo.inputBox.value.trim();
  const staged = repo.state.indexChanges.length;
  const pending =
    staged +
    repo.state.workingTreeChanges.length +
    repo.state.untrackedChanges.length;
  if (
    pending === 0 &&
    !repo.state.rebaseCommit &&
    repo.state.mergeChanges.length === 0
  ) {
    return {
      status: "skipped",
      detail: vscode.l10n.t("No changes to commit."),
    };
  }
  if (!message) {
    return { status: "failed", detail: vscode.l10n.t("No commit message.") };
  }
  if (staged === 0) {
    const paths = uniquePaths([
      ...repo.state.workingTreeChanges,
      ...repo.state.untrackedChanges,
    ]);
    if (paths.length > 0) {
      await repo.add(paths);
    }
  }
  const before = repo.state.HEAD?.commit;
  await git(repo, commitArgs(message), token);
  repo.inputBox.value = "";
  if (
    interpretCommitResult({
      before,
      after: repo.state.HEAD?.commit,
      hadChanges: true,
    }) !== "ok"
  ) {
    return {
      status: "failed",
      detail: vscode.l10n.t("Commit was not created."),
    };
  }
  return { status: "ok" };
}

async function fetchRemote(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  const remote =
    repo.state.HEAD?.upstream?.remote ?? repo.state.remotes[0]?.name;
  await git(repo, fetchArgs(remote), token);
  return { status: "ok" };
}

async function pull(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  const head = repo.state.HEAD;
  if (!head?.name) {
    return { status: "skipped", detail: vscode.l10n.t("Detached HEAD.") };
  }
  if (!head.upstream) {
    return {
      status: "failed",
      detail: vscode.l10n.t("The branch has no upstream."),
    };
  }
  await git(repo, pullArgs(), token);
  return { status: "ok" };
}

async function push(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  const head = repo.state.HEAD;
  if (!head?.name) {
    return { status: "skipped", detail: vscode.l10n.t("Detached HEAD.") };
  }
  if (!head.upstream) {
    return {
      status: "failed",
      detail: vscode.l10n.t("The branch has no upstream."),
    };
  }
  await git(
    repo,
    pushArgs({ name: head.name, upstream: head.upstream }),
    token,
  );
  return { status: "ok" };
}

async function sync(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  const head = repo.state.HEAD;
  if (!head?.name) {
    return { status: "skipped", detail: vscode.l10n.t("Detached HEAD.") };
  }
  if (!head.upstream) {
    return {
      status: "failed",
      detail: vscode.l10n.t("The branch has no upstream."),
    };
  }
  const [pullCommand, pushCommand] = syncArgs({
    name: head.name,
    upstream: head.upstream,
  });
  await git(repo, pullCommand, token);
  await git(repo, pushCommand, token);
  return { status: "ok" };
}

async function publish(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
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
  await git(
    repo,
    pushArgs(
      { name: head.name, upstream: head.upstream },
      { remote, setUpstream: !head.upstream },
    ),
    token,
  );
  return { status: "ok" };
}

async function stash(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  if (!repositoryHasChanges(repo)) {
    return { status: "skipped", detail: vscode.l10n.t("No changes to stash.") };
  }
  await git(repo, stashArgs(), token);
  return { status: "ok" };
}

async function stashPop(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
  await git(repo, stashPopArgs(), token);
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
    await git(repo, rebaseArgs(name), token);
  } catch (error) {
    await repo.status().catch(() => undefined);
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
  await git(
    repo,
    pushArgs(
      { name: head.name, upstream: head.upstream },
      { remote: parsed.remote, setUpstream: !head.upstream },
    ),
    token,
  );
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
    await git(repo, rebaseAbortArgs());
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

async function forcePush(
  repo: GitRepository,
  token: vscode.CancellationToken,
): Promise<StepOutcome> {
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
  await git(
    repo,
    pushArgs(
      { name: head.name, upstream: head.upstream },
      { forceWithLease: true },
    ),
    token,
  );
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
