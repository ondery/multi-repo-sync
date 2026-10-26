import * as vscode from "vscode";
import { checkoutRef } from "../git/actions";
import type { GitCommit, GitRepository } from "../git/types";
import { layoutGraph } from "../history/graph";
import {
  branchNameOnGitHub,
  githubBranchUrl,
  githubCommitUrl,
  githubRemote,
  githubTagUrl,
  type GitHubRepoRef,
} from "../github/remote";
import { timelineLimit } from "../pipeline/settings";
import type { RepoModel } from "../repos/model";
import { errorMessage } from "../util/error";

type RefKind = "head" | "remote" | "tag";

interface TimelineRef {
  name: string;
  kind: RefKind;
}

interface TimelineRow {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  lane: number;
  parentLanes: number[];
  through: number[];
  fromAbove: boolean;
  laneCount: number;
  refs: TimelineRef[];
}

type WebviewMessage =
  | { type: "ready" }
  | { type: "commit"; hash?: string }
  | { type: "ref"; name?: string; kind?: string };

export class TimelineView
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private root: string | undefined;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly model: RepoModel,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.onMessage(message as WebviewMessage);
      }),
    );
    this.disposables.push(
      webviewView.onDidDispose(() => {
        this.view = undefined;
      }),
    );
  }

  show(root: string | undefined): void {
    if (root === this.root) {
      return;
    }
    this.root = root;
    this.refresh();
  }

  refresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.render();
    }, 100);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async render(): Promise<void> {
    const generation = ++this.generation;
    const root = this.root;
    if (!root) {
      this.post({
        type: "empty",
        text: vscode.l10n.t(
          "Select a repository to see its branches and commits.",
        ),
      });
      return;
    }
    const repo = this.model.find(root);
    if (!repo) {
      this.post({
        type: "empty",
        text: vscode.l10n.t(
          "Select a repository to see its branches and commits.",
        ),
      });
      return;
    }
    try {
      const payload = await this.load(repo);
      if (generation !== this.generation) {
        return;
      }
      this.post({
        type: "history",
        title: payload.title,
        emptyText: vscode.l10n.t("No commits yet."),
        rows: payload.rows,
      });
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.post({
        type: "empty",
        text:
          errorMessage(error) || vscode.l10n.t("Could not load the timeline."),
      });
    }
  }

  private async load(
    repo: GitRepository,
  ): Promise<{ title: string; rows: TimelineRow[] }> {
    const limit = timelineLimit();
    const [commits, heads, remotes, tags] = await Promise.all([
      repo.log({ maxEntries: limit }),
      repo.getRefs({ pattern: "refs/heads", count: 200 }).catch(() => []),
      repo.getRefs({ pattern: "refs/remotes", count: 200 }).catch(() => []),
      repo.getRefs({ pattern: "refs/tags", count: 100 }).catch(() => []),
    ]);
    const refs = new Map<string, TimelineRef[]>();
    const add = (hash: string | undefined, ref: TimelineRef) => {
      if (!hash || !ref.name) {
        return;
      }
      const list = refs.get(hash) ?? [];
      if (
        !list.some((item) => item.name === ref.name && item.kind === ref.kind)
      ) {
        list.push(ref);
      }
      refs.set(hash, list);
    };
    for (const ref of heads) {
      if (!isSymbolicHead(ref.name)) {
        add(ref.commit, { name: ref.name ?? "", kind: "head" });
      }
    }
    for (const ref of remotes) {
      if (!isSymbolicHead(ref.name)) {
        add(ref.commit, { name: ref.name ?? "", kind: "remote" });
      }
    }
    for (const ref of tags) {
      if (ref.name) {
        add(ref.commit, { name: ref.name, kind: "tag" });
      }
    }
    if (!repo.state.HEAD?.name && repo.state.HEAD?.commit) {
      add(repo.state.HEAD.commit, { name: "HEAD", kind: "head" });
    }

    const layout = layoutGraph(
      commits.map((commit) => ({ hash: commit.hash, parents: commit.parents })),
    );
    const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
    const rows = layout.map((row) => {
      const commit = byHash.get(row.hash);
      const decorated = (refs.get(row.hash) ?? []).slice(0, 8);
      return {
        hash: row.hash,
        shortHash: row.hash.slice(0, 7),
        subject: commit ? subjectOf(commit.message) : row.hash.slice(0, 7),
        author: commit?.authorName ?? "",
        date: formatWhen(commitDate(commit)),
        lane: row.lane,
        parentLanes: row.parentLanes,
        through: row.through,
        fromAbove: row.fromAbove,
        laneCount: row.laneCount,
        refs: decorated,
      };
    });
    const branch =
      repo.state.HEAD?.name ??
      (repo.state.HEAD?.commit ? repo.state.HEAD.commit.slice(0, 7) : "");
    const title = branch
      ? `${this.model.label(repo.rootUri.fsPath)} · ${branch}`
      : this.model.label(repo.rootUri.fsPath);
    return { title, rows };
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    if (message.type === "ready") {
      await this.render();
      return;
    }
    const repo = this.root ? this.model.find(this.root) : undefined;
    if (!repo) {
      return;
    }
    if (message.type === "commit" && message.hash) {
      await this.onCommit(repo, message.hash);
      return;
    }
    if (message.type === "ref" && message.name && message.kind) {
      await this.onRef(repo, message.name, message.kind);
    }
  }

  private async onCommit(repo: GitRepository, hash: string): Promise<void> {
    const action = await this.pickAction(
      Boolean(githubRemote(repo.state.remotes)),
      hash.slice(0, 7),
    );
    if (action === "copy") {
      await vscode.env.clipboard.writeText(hash);
      return;
    }
    if (action === "open") {
      const parsed = githubRemote(repo.state.remotes);
      if (parsed) {
        await vscode.env.openExternal(
          vscode.Uri.parse(githubCommitUrl(parsed.repo, hash)),
        );
      }
      return;
    }
    if (action !== "checkout") {
      return;
    }
    const checkout = vscode.l10n.t("Checkout");
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t("Check out {0}? This detaches HEAD.", hash.slice(0, 7)),
      { modal: true },
      checkout,
    );
    if (confirmed !== checkout) {
      return;
    }
    try {
      await repo.checkout(hash);
    } catch (error) {
      void vscode.window.showErrorMessage(errorMessage(error));
    }
  }

  private async onRef(
    repo: GitRepository,
    name: string,
    kind: string,
  ): Promise<void> {
    const parsed = githubRemote(repo.state.remotes);
    const action = await this.pickAction(Boolean(parsed), name);
    if (!action) {
      return;
    }
    if (action === "copy") {
      await vscode.env.clipboard.writeText(name);
      return;
    }
    if (action === "open") {
      if (!parsed) {
        return;
      }
      await vscode.env.openExternal(
        vscode.Uri.parse(refUrl(parsed.repo, name, kind)),
      );
      return;
    }
    if (kind === "tag") {
      const checkout = vscode.l10n.t("Checkout");
      const confirmed = await vscode.window.showWarningMessage(
        vscode.l10n.t("Check out {0}? This detaches HEAD.", name),
        { modal: true },
        checkout,
      );
      if (confirmed !== checkout) {
        return;
      }
    }
    try {
      if (kind === "remote") {
        await checkoutRef(repo, name, true);
      } else {
        await repo.checkout(name);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(errorMessage(error));
    }
  }

  private async pickAction(
    github: boolean,
    placeHolder: string,
  ): Promise<"checkout" | "copy" | "open" | undefined> {
    const items: Array<
      vscode.QuickPickItem & { action: "checkout" | "copy" | "open" }
    > = [
      { label: vscode.l10n.t("Checkout"), action: "checkout" },
      { label: vscode.l10n.t("Copy"), action: "copy" },
    ];
    if (github) {
      items.push({ label: vscode.l10n.t("Open on GitHub"), action: "open" });
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder,
      ignoreFocusOut: true,
    });
    return picked?.action;
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = createNonce();
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "timeline.js"),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "timeline.css"),
    );
    const empty = escapeHtml(
      vscode.l10n.t("Select a repository to see its branches and commits."),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
  <title>Multi Repo Sync</title>
</head>
<body>
  <div id="root"><p class="empty">${empty}</p></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function refUrl(repo: GitHubRepoRef, name: string, kind: string): string {
  if (kind === "tag") {
    return githubTagUrl(repo, name);
  }
  return githubBranchUrl(repo, branchNameOnGitHub(name, kind === "remote"));
}

function subjectOf(message: string): string {
  return message.split(/\r?\n/, 1)[0]?.trim() || message;
}

function commitDate(commit: GitCommit | undefined): Date | undefined {
  const value = commit?.authorDate ?? commit?.commitDate;
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatWhen(date: Date | undefined): string {
  if (!date) {
    return "";
  }
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat(vscode.env.language, {
    numeric: "auto",
  });
  if (abs < 60) {
    return format.format(seconds, "second");
  }
  if (abs < 3600) {
    return format.format(Math.round(seconds / 60), "minute");
  }
  if (abs < 86400) {
    return format.format(Math.round(seconds / 3600), "hour");
  }
  if (abs < 86400 * 30) {
    return format.format(Math.round(seconds / 86400), "day");
  }
  if (abs < 86400 * 365) {
    return format.format(Math.round(seconds / (86400 * 30)), "month");
  }
  return format.format(Math.round(seconds / (86400 * 365)), "year");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function createNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 24 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}

function isSymbolicHead(name: string | undefined): boolean {
  return !name || name === "HEAD" || name.endsWith("/HEAD");
}
