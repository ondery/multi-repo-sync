import * as vscode from "vscode";
import { loadGitExtension } from "./git/api";
import type { GitApi, GitExtension } from "./git/types";
import { PipelineRunner } from "./pipeline/runner";
import { RepoModel } from "./repos/model";
import { ExtensionState } from "./state/store";
import { registerCommands } from "./views/commands";
import { OperationsView } from "./views/operationsView";
import { RepositoryTree } from "./views/repositoryTree";
import { TimelineView } from "./views/timelineView";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output = vscode.window.createOutputChannel("Multi Repo Sync");
  const store = new ExtensionState(context);
  const model = new RepoModel();
  const repositories = new RepositoryTree(model, store);
  const operations = new OperationsView(context.extensionUri, store);
  const timeline = new TimelineView(context.extensionUri, model);
  const runner = new PipelineRunner(model, store, output, operations);

  const repoView = vscode.window.createTreeView("multiRepoSync.repositories", {
    treeDataProvider: repositories,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  });
  repoView.description = vscode.l10n.t("Git and GitHub control");

  const updateBadge = () => {
    const selected = model
      .list()
      .filter((repo) => store.isSelected(repo.rootUri.fsPath)).length;
    repoView.badge =
      selected > 0
        ? {
            value: selected,
            tooltip: vscode.l10n.t("{0} repositories selected", selected),
          }
        : undefined;
    setContext("multiRepoSync.noRepositories", model.list().length === 0);
  };

  context.subscriptions.push(
    output,
    model,
    repositories,
    operations,
    timeline,
    repoView,
    vscode.window.registerWebviewViewProvider(
      "multiRepoSync.operations",
      operations,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    repoView.onDidChangeCheckboxState((event) => {
      void (async () => {
        for (const [node, state] of event.items) {
          if (node.kind === "repo") {
            await store.setRootSelected(
              node.root,
              state === vscode.TreeItemCheckboxState.Checked,
            );
          }
        }
        repositories.refresh(true);
        updateBadge();
      })();
    }),
    repoView.onDidChangeSelection((event) => {
      const node = event.selection[0];
      if (node && node.kind !== "info") {
        timeline.show(node.root);
      }
    }),
    model.onDidChange(() => {
      updateBadge();
      repositories.refresh(false);
      timeline.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("multiRepoSync")) {
        repositories.refresh(true);
        timeline.refresh();
      }
    }),
    vscode.window.registerWebviewViewProvider(
      "multiRepoSync.timeline",
      timeline,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  registerCommands(context, {
    model,
    store,
    repositories,
    runner,
    timeline,
    updateBadge,
  });

  setContext("multiRepoSync.running", false);
  setContext("multiRepoSync.ready", false);
  setContext("multiRepoSync.noRepositories", true);
  setContext("multiRepoSync.gitUnavailable", false);
  repoView.message = vscode.l10n.t("Loading Git repositories…");

  const git = await loadGitExtension();
  if (!git) {
    setContext("multiRepoSync.gitUnavailable", true);
    setContext("multiRepoSync.ready", true);
    repoView.message = undefined;
    return;
  }
  watchGit(
    context,
    git,
    (api) => {
      model.setApi(api);
      setContext("multiRepoSync.gitUnavailable", false);
      setContext("multiRepoSync.ready", true);
      repoView.message = undefined;
      updateBadge();
    },
    () => {
      repoView.message = undefined;
    },
  );
}

export function deactivate(): void {
  // Disposables are released through the extension context.
}

function watchGit(
  context: vscode.ExtensionContext,
  git: GitExtension,
  connect: (api: GitApi) => void,
  onUnavailable: () => void,
): void {
  let connected = false;
  const attach = () => {
    if (!git.enabled) {
      setContext("multiRepoSync.gitUnavailable", true);
      setContext("multiRepoSync.ready", true);
      onUnavailable();
      return;
    }
    const api = git.getAPI(1);
    const finish = () => {
      if (connected) {
        return;
      }
      connected = true;
      connect(api);
    };
    if (api.state === "initialized") {
      finish();
      return;
    }
    context.subscriptions.push(
      api.onDidChangeState((state) => {
        if (state === "initialized") {
          finish();
        }
      }),
    );
  };
  attach();
  context.subscriptions.push(git.onDidChangeEnablement(() => attach()));
}

function setContext(key: string, value: boolean): void {
  void vscode.commands.executeCommand("setContext", key, value);
}
