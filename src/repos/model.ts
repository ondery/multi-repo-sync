import * as vscode from 'vscode';
import type { GitApi, GitRepository } from '../git/types';
import { labelsFor, normalizeKey, sameRoot } from '../util/path';

export class RepoModel implements vscode.Disposable {
  private api: GitApi | undefined;
  private readonly repos = new Map<string, GitRepository>();
  private readonly repoSubscriptions = new Map<string, vscode.Disposable>();
  private readonly apiSubscriptions: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  setApi(api: GitApi): void {
    if (this.api === api) {
      return;
    }
    this.disposeApi();
    this.api = api;
    for (const repo of api.repositories) {
      this.track(repo);
    }
    this.apiSubscriptions.push(
      api.onDidOpenRepository(repo => {
        this.track(repo);
        this.changed.fire();
      }),
      api.onDidCloseRepository(repo => {
        this.untrack(repo.rootUri.fsPath);
        this.changed.fire();
      }),
    );
    this.changed.fire();
  }

  list(): GitRepository[] {
    return [...this.repos.values()].sort((a, b) => a.rootUri.fsPath.localeCompare(b.rootUri.fsPath));
  }

  find(root: string): GitRepository | undefined {
    return this.repos.get(normalizeKey(root)) ?? [...this.repos.values()].find(repo => sameRoot(repo.rootUri.fsPath, root));
  }

  label(root: string): string {
    return labelsFor(this.list().map(repo => repo.rootUri.fsPath)).get(normalizeKey(root)) ?? root;
  }

  dispose(): void {
    this.disposeApi();
    this.changed.dispose();
  }

  private track(repo: GitRepository): void {
    const key = normalizeKey(repo.rootUri.fsPath);
    this.untrack(key);
    this.repos.set(key, repo);
    this.repoSubscriptions.set(key, repo.state.onDidChange(() => this.changed.fire()));
  }

  private untrack(root: string): void {
    const key = normalizeKey(root);
    this.repoSubscriptions.get(key)?.dispose();
    this.repoSubscriptions.delete(key);
    this.repos.delete(key);
  }

  private disposeApi(): void {
    for (const subscription of this.apiSubscriptions) {
      subscription.dispose();
    }
    this.apiSubscriptions.length = 0;
    for (const key of [...this.repos.keys()]) {
      this.untrack(key);
    }
    this.api = undefined;
  }
}
