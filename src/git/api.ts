import * as vscode from 'vscode';
import type { GitApi, GitExtension } from './types';

export async function loadGitExtension(): Promise<GitExtension | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    return undefined;
  }
  return extension.isActive ? extension.exports : extension.activate();
}

export async function whenGitReady(git: GitExtension): Promise<GitApi | undefined> {
  if (!git.enabled) {
    return undefined;
  }
  const api = git.getAPI(1);
  if (api.state === 'initialized') {
    return api;
  }
  return new Promise(resolve => {
    const subscription = api.onDidChangeState(state => {
      if (state === 'initialized') {
        subscription.dispose();
        resolve(api);
      }
    });
  });
}
