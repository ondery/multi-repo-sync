import type { OperationId } from './catalog';

export interface OperationPreset {
  id: string;
  operations: readonly OperationId[];
}

export interface PresetSnapshot {
  order: string[];
  enabled: string[];
}

export interface UserPreset {
  id: string;
  name: string;
  order: string[];
  enabled: string[];
}

export const OPERATION_PRESETS: readonly OperationPreset[] = [
  { id: 'fetch', operations: ['fetch'] },
  { id: 'pull', operations: ['pull'] },
  { id: 'sync', operations: ['fetch', 'pull', 'push'] },
  { id: 'stageCommitPush', operations: ['stageAll', 'commit', 'push'] },
  { id: 'commitPush', operations: ['commit', 'push'] },
  { id: 'publish', operations: ['publishBranch'] },
  { id: 'pullRequest', operations: ['push', 'createPullRequest'] },
];

export function builtinPreset(id: string): OperationPreset | undefined {
  return OPERATION_PRESETS.find(preset => preset.id === id);
}

export function normalizePresetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function presetNameTaken(
  name: string,
  presets: readonly { id?: string; name: string }[],
  exceptId?: string,
): boolean {
  const key = normalizePresetName(name).toLocaleLowerCase();
  if (!key) {
    return false;
  }
  return presets.some(preset => preset.id !== exceptId && preset.name.toLocaleLowerCase() === key);
}

export function snapshotFrom(order: readonly string[], enabled: readonly string[]): PresetSnapshot {
  const enabledSet = new Set(enabled);
  return {
    order: [...order],
    enabled: order.filter(id => enabledSet.has(id)),
  };
}

export function sameSnapshot(left: PresetSnapshot, right: PresetSnapshot): boolean {
  return sameList(left.order, right.order) && sameList(left.enabled, right.enabled);
}

export function upsertPreset(presets: readonly UserPreset[], preset: UserPreset): UserPreset[] {
  const index = presets.findIndex(item => item.id === preset.id);
  if (index === -1) {
    return [...presets, preset];
  }
  const next = [...presets];
  next[index] = preset;
  return next;
}

export function removePreset(presets: readonly UserPreset[], id: string): UserPreset[] {
  return presets.filter(preset => preset.id !== id);
}

export function renamePreset(presets: readonly UserPreset[], id: string, name: string): UserPreset[] {
  return presets.map(preset => preset.id === id ? { ...preset, name } : preset);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
