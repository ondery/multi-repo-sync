import * as vscode from "vscode";
import type { GitChange, GitRepository } from "../git/types";
import { relativePath } from "../util/path";

export type ReviewMode = "stage" | "commit";
export type ReviewResult = "continue" | "cancel" | "committed";

const GENERATE_COMMANDS = [
  "cursor.generateGitCommitMessage",
  "github.copilot.git.generateCommitMessage",
];

interface ReviewMessage {
  type?: string;
  fsPath?: string;
  original?: string;
}

export async function reviewChanges(
  repo: GitRepository,
  token: vscode.CancellationToken,
  mode: ReviewMode,
): Promise<ReviewResult> {
  await repo.status();
  if (!hasReviewableChanges(repo)) {
    return "continue";
  }

  const file = firstChangeUri(repo);
  if (file) {
    await vscode.window.showTextDocument(file, {
      preview: true,
      preserveFocus: true,
    });
  }
  await vscode.commands.executeCommand("workbench.view.scm");

  const panel = vscode.window.createWebviewPanel(
    "multiRepoSync.stageReview",
    mode === "commit"
      ? vscode.l10n.t("Commit · {0}", repoName(repo))
      : vscode.l10n.t("Stage · {0}", repoName(repo)),
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = html(mode);
  postFiles(panel, repo, mode);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ReviewResult) => {
      if (settled) {
        return;
      }
      settled = true;
      subscription.dispose();
      cancel.dispose();
      panel.dispose();
      resolve(result);
    };
    const subscription = repo.state.onDidChange(() =>
      postFiles(panel, repo, mode),
    );
    const cancel = token.onCancellationRequested(() => finish("cancel"));
    panel.onDidDispose(() => finish("cancel"));
    panel.webview.onDidReceiveMessage(async (message: ReviewMessage) => {
      try {
        if (message.type === "stage" && message.fsPath) {
          await repo.add([message.fsPath]);
        } else if (message.type === "unstage" && message.fsPath) {
          await repo.revert([message.fsPath]);
        } else if (message.type === "stageAll") {
          const paths = uniquePaths([
            ...repo.state.workingTreeChanges,
            ...repo.state.untrackedChanges,
          ]);
          if (paths.length > 0) {
            await repo.add(paths);
          }
        } else if (message.type === "unstageAll") {
          const paths = uniquePaths(repo.state.indexChanges);
          if (paths.length > 0) {
            await repo.revert(paths);
          }
        } else if (message.type === "open" && message.fsPath) {
          await openChange(message.fsPath, message.original);
        } else if (message.type === "generate") {
          const generated = await generateCommitMessage(repo);
          if (!generated) {
            void vscode.window.showErrorMessage(
              vscode.l10n.t(
                "Generate Commit Message is not available in this editor.",
              ),
            );
          }
        } else if (message.type === "continue") {
          finish("continue");
          return;
        } else if (message.type === "cancel") {
          finish("cancel");
          return;
        } else if (message.type === "commit") {
          const before = repo.state.HEAD?.commit;
          await vscode.commands.executeCommand(
            "git.commit",
            repo.rootUri.fsPath,
            null,
          );
          await repo.status().catch(() => undefined);
          if (repo.state.HEAD?.commit && repo.state.HEAD.commit !== before) {
            finish("committed");
            return;
          }
          void panel.webview.postMessage({
            type: "notice",
            text: vscode.l10n.t(
              "Commit was not created. Generate or write a message, then try again.",
            ),
          });
        }
        await repo.status().catch(() => undefined);
        postFiles(panel, repo, mode);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(text);
      }
    });
  });
}

export async function generateCommitMessage(
  repo: GitRepository,
): Promise<boolean> {
  await vscode.commands.executeCommand("workbench.view.scm");
  await vscode.commands.executeCommand("workbench.scm.focus");
  const known = new Set(await vscode.commands.getCommands(true));
  const command = GENERATE_COMMANDS.find((id) => known.has(id));
  if (!command) {
    return false;
  }
  try {
    await vscode.commands.executeCommand(command, repo.rootUri);
  } catch {
    try {
      await vscode.commands.executeCommand(command);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(text);
      return false;
    }
  }
  return true;
}

function postFiles(
  panel: vscode.WebviewPanel,
  repo: GitRepository,
  mode: ReviewMode,
): void {
  const root = repo.rootUri.fsPath;
  const staged = repo.state.indexChanges.map((change) =>
    toRow(root, change, "staged"),
  );
  const changes = [
    ...repo.state.workingTreeChanges.map((change) =>
      toRow(root, change, "unstaged"),
    ),
    ...repo.state.untrackedChanges.map((change) =>
      toRow(root, change, "untracked"),
    ),
  ];
  void panel.webview.postMessage({
    type: "files",
    mode,
    staged: staged.sort(byPath),
    changes: changes.sort(byPath),
    labels: {
      staged: vscode.l10n.t("Staged Changes"),
      changes: vscode.l10n.t("Changes"),
      stage: vscode.l10n.t("Stage"),
      unstage: vscode.l10n.t("Unstage"),
      stageAll: vscode.l10n.t("Stage All"),
      unstageAll: vscode.l10n.t("Unstage All"),
      emptyStaged: vscode.l10n.t("No staged changes."),
      emptyChanges: vscode.l10n.t("No unstaged changes."),
      generate: vscode.l10n.t("Generate Commit Message"),
      commit: vscode.l10n.t("Commit"),
      continue: vscode.l10n.t("Continue"),
      cancel: vscode.l10n.t("Cancel"),
      hint:
        mode === "commit"
          ? vscode.l10n.t(
              "Stage the files to include, generate or write the message in Source Control, then commit.",
            )
          : vscode.l10n.t(
              "Choose the files to stage. Continue when the index looks right.",
            ),
    },
  });
}

function toRow(
  root: string,
  change: GitChange,
  group: "staged" | "unstaged" | "untracked",
) {
  return {
    fsPath: change.uri.fsPath,
    path: relativePath(root, change.uri.fsPath),
    original: group === "untracked" ? "" : change.originalUri.toString(),
    badge: statusBadge(change.status, group),
  };
}

function statusBadge(status: number, group: string): string {
  if (group === "untracked" || status === 7) {
    return "U";
  }
  if (
    status === 2 ||
    status === 6 ||
    status === 14 ||
    status === 15 ||
    status === 17
  ) {
    return "D";
  }
  if (
    status === 1 ||
    status === 9 ||
    status === 12 ||
    status === 13 ||
    status === 16
  ) {
    return "A";
  }
  if (status === 3 || status === 10) {
    return "R";
  }
  return "M";
}

function byPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path);
}

function uniquePaths(changes: readonly GitChange[]): string[] {
  return [
    ...new Set(changes.map((change) => change.uri.fsPath).filter(Boolean)),
  ];
}

function hasReviewableChanges(repo: GitRepository): boolean {
  const state = repo.state;
  return (
    state.indexChanges.length +
      state.workingTreeChanges.length +
      state.untrackedChanges.length >
    0
  );
}

function firstChangeUri(repo: GitRepository): vscode.Uri | undefined {
  return (
    repo.state.workingTreeChanges[0]?.uri ??
    repo.state.untrackedChanges[0]?.uri ??
    repo.state.indexChanges[0]?.uri
  );
}

function repoName(repo: GitRepository): string {
  return (
    repo.rootUri.fsPath.split(/[\\/]/).filter(Boolean).pop() ??
    repo.rootUri.fsPath
  );
}

async function openChange(
  fsPath: string,
  original: string | undefined,
): Promise<void> {
  const right = vscode.Uri.file(fsPath);
  if (!original) {
    await vscode.commands.executeCommand("vscode.open", right);
    return;
  }
  await vscode.commands.executeCommand(
    "vscode.diff",
    vscode.Uri.parse(original),
    right,
    relativePath("", fsPath),
  );
}

function html(mode: ReviewMode): string {
  const nonce = Array.from(
    { length: 24 },
    () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
        Math.floor(Math.random() * 62)
      ],
  ).join("");
  const generate = mode === "commit";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    .page { display: flex; flex-direction: column; min-height: 100vh; }
    .hint, .empty { color: var(--vscode-descriptionForeground); }
    .hint { margin: 0; padding: 12px 16px 4px; }
    #notice { margin: 0; padding: 0 16px 8px; color: var(--vscode-editorWarning-foreground); }
    #notice:empty { display: none; }
    main { flex: 1; padding: 0 8px 16px; }
    section { margin-top: 8px; }
    h2 { display: flex; align-items: center; justify-content: space-between; margin: 0; padding: 6px 8px; font-size: 0.85em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 2px 8px; }
    li:hover { background: var(--vscode-list-hoverBackground); }
    .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; padding: 0; }
    .badge { width: 16px; text-align: center; font-size: 0.85em; color: var(--vscode-gitDecoration-modifiedResourceForeground); }
    .badge.A, .badge.U { color: var(--vscode-gitDecoration-addedResourceForeground); }
    .badge.D { color: var(--vscode-gitDecoration-deletedResourceForeground); }
    button.action, .group button, .footer button { font: inherit; cursor: pointer; border-radius: 2px; }
    button.action, .group button { border: 0; background: transparent; color: var(--vscode-textLink-foreground); }
    .footer { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); position: sticky; bottom: 0; }
    .footer button { height: 32px; padding: 0 12px; border: 0; }
    #generate, #done { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    #cancel { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  </style>
</head>
<body>
  <div class="page">
    <p id="hint" class="hint"></p>
    <p id="notice"></p>
    <main>
      <section>
        <h2><span id="staged-title"></span><button id="unstage-all" type="button"></button></h2>
        <ul id="staged"></ul>
      </section>
      <section>
        <h2><span id="changes-title"></span><button id="stage-all" type="button"></button></h2>
        <ul id="changes"></ul>
      </section>
    </main>
    <div class="footer">
      ${generate ? '<button id="generate" type="button"></button>' : ""}
      <button id="done" type="button"></button>
      <button id="cancel" type="button"></button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const hint = document.getElementById('hint');
    const notice = document.getElementById('notice');
    const stagedList = document.getElementById('staged');
    const changeList = document.getElementById('changes');
    const stagedTitle = document.getElementById('staged-title');
    const changesTitle = document.getElementById('changes-title');
    const stageAll = document.getElementById('stage-all');
    const unstageAll = document.getElementById('unstage-all');
    const done = document.getElementById('done');
    const cancel = document.getElementById('cancel');
    const generate = document.getElementById('generate');
    let labels = {};
    stageAll.addEventListener('click', () => vscode.postMessage({ type: 'stageAll' }));
    unstageAll.addEventListener('click', () => vscode.postMessage({ type: 'unstageAll' }));
    done.addEventListener('click', () => vscode.postMessage({ type: ${generate ? "'commit'" : "'continue'"} }));
    cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    generate?.addEventListener('click', () => vscode.postMessage({ type: 'generate' }));
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === 'notice') {
        notice.textContent = message.text || '';
        return;
      }
      if (message.type !== 'files') return;
      labels = message.labels || {};
      hint.textContent = labels.hint || '';
      stagedTitle.textContent = labels.staged || '';
      changesTitle.textContent = labels.changes || '';
      stageAll.textContent = labels.stageAll || '';
      unstageAll.textContent = labels.unstageAll || '';
      done.textContent = message.mode === 'commit' ? (labels.commit || 'Commit') : (labels.continue || 'Continue');
      cancel.textContent = labels.cancel || 'Cancel';
      if (generate) generate.textContent = labels.generate || 'Generate Commit Message';
      render(stagedList, message.staged || [], 'unstage', labels.unstage || 'Unstage', labels.emptyStaged || '');
      render(changeList, message.changes || [], 'stage', labels.stage || 'Stage', labels.emptyChanges || '');
    });
    function render(list, rows, action, actionLabel, empty) {
      list.replaceChildren();
      if (rows.length === 0) {
        const item = document.createElement('li');
        item.className = 'empty';
        item.textContent = empty;
        list.appendChild(item);
        return;
      }
      for (const row of rows) {
        const item = document.createElement('li');
        const badge = document.createElement('span');
        badge.className = 'badge ' + row.badge;
        badge.textContent = row.badge;
        const path = document.createElement('button');
        path.className = 'path';
        path.type = 'button';
        path.textContent = row.path;
        path.addEventListener('click', () => vscode.postMessage({ type: 'open', fsPath: row.fsPath, original: row.original }));
        const button = document.createElement('button');
        button.className = 'action';
        button.type = 'button';
        button.textContent = actionLabel;
        button.addEventListener('click', () => vscode.postMessage({ type: action, fsPath: row.fsPath }));
        item.append(badge, path, button);
        list.appendChild(item);
      }
    }
  </script>
</body>
</html>`;
}
