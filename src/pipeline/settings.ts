import * as vscode from 'vscode';
import type { RunOrder } from './order';

export type OnError = 'stop' | 'skipRepository' | 'continue';

export function readRunSettings(): { order: RunOrder; onError: OnError } {
  const config = vscode.workspace.getConfiguration('multiRepoSync');
  const order = config.get<string>('runOrder');
  const onError = config.get<string>('onError');
  return {
    order: order === 'perOperation' ? 'perOperation' : 'perRepository',
    onError: onError === 'skipRepository' || onError === 'continue' ? onError : 'stop',
  };
}

export function timelineLimit(): number {
  const value = vscode.workspace.getConfiguration('multiRepoSync').get<number>('timelineLimit', 50);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 50;
  }
  return Math.min(500, Math.max(10, Math.floor(value)));
}
