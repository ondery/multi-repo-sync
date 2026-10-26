import * as vscode from "vscode";
import { OPERATION_IDS, OperationId, isOperationId } from "../pipeline/catalog";
import { mergeOrder, placeGenerateCommitMessage } from "../pipeline/order";
import {
  removePreset,
  renamePreset,
  upsertPreset,
  type PresetSnapshot,
  type UserPreset,
} from "../pipeline/presets";
import { sameRoot } from "../util/path";

const SELECTED = "multiRepoSync.selectedRoots";
const ORDER = "multiRepoSync.operationOrder";
const ENABLED = "multiRepoSync.enabledOperations";
const USER_PRESETS = "multiRepoSync.userPresets";
const ACTIVE_PRESET = "multiRepoSync.activePreset";

export class ExtensionState {
  constructor(private readonly context: vscode.ExtensionContext) {}

  selectedRoots(): string[] {
    return this.context.workspaceState.get<string[]>(SELECTED, []);
  }

  isSelected(root: string): boolean {
    return this.selectedRoots().some((item) => sameRoot(item, root));
  }

  async setRootSelected(root: string, selected: boolean): Promise<void> {
    const current = this.selectedRoots().filter(
      (item) => !sameRoot(item, root),
    );
    if (selected) {
      current.push(root);
    }
    await this.context.workspaceState.update(SELECTED, current);
  }

  async setSelectedRoots(roots: string[]): Promise<void> {
    await this.context.workspaceState.update(SELECTED, roots);
  }

  operationOrder(): OperationId[] {
    const saved = this.context.workspaceState.get<string[]>(ORDER);
    return placeGenerateCommitMessage(
      saved,
      mergeOrder(saved, OPERATION_IDS),
    ).filter(isOperationId);
  }

  async setOperationOrder(order: readonly OperationId[]): Promise<void> {
    await this.context.workspaceState.update(ORDER, [...order]);
  }

  enabledOperations(): OperationId[] {
    const saved = this.context.workspaceState.get<string[]>(ENABLED);
    if (!saved) {
      return [];
    }
    const enabled = new Set(saved);
    return this.operationOrder().filter((id) => enabled.has(id));
  }

  async setEnabledOperations(ids: readonly OperationId[]): Promise<void> {
    const allowed = new Set(this.operationOrder());
    const next = ids.filter(
      (id, index) => allowed.has(id) && ids.indexOf(id) === index,
    );
    await this.context.workspaceState.update(ENABLED, next);
  }

  async setOperationEnabled(id: OperationId, enabled: boolean): Promise<void> {
    const next = new Set(this.enabledOperations());
    if (enabled) {
      next.add(id);
    } else {
      next.delete(id);
    }
    const ordered = this.operationOrder().filter((operation) =>
      next.has(operation),
    );
    await this.context.workspaceState.update(ENABLED, ordered);
  }

  userPresets(): UserPreset[] {
    const raw = this.context.globalState.get<unknown>(USER_PRESETS, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap(parseUserPreset);
  }

  async saveUserPreset(preset: UserPreset): Promise<void> {
    await this.context.globalState.update(
      USER_PRESETS,
      upsertPreset(this.userPresets(), preset),
    );
  }

  async renameUserPreset(id: string, name: string): Promise<void> {
    await this.context.globalState.update(
      USER_PRESETS,
      renamePreset(this.userPresets(), id, name),
    );
  }

  async deleteUserPreset(id: string): Promise<void> {
    await this.context.globalState.update(
      USER_PRESETS,
      removePreset(this.userPresets(), id),
    );
    if (this.activePreset()?.id === id) {
      await this.clearActivePreset();
    }
  }

  activePreset(): (PresetSnapshot & { id: string }) | undefined {
    const raw = this.context.workspaceState.get<unknown>(ACTIVE_PRESET);
    const parsed = parseActivePreset(raw);
    return parsed;
  }

  async setActivePreset(id: string, snapshot: PresetSnapshot): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_PRESET, {
      id,
      ...snapshot,
    });
  }

  async clearActivePreset(): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_PRESET, undefined);
  }
}

function parseUserPreset(value: unknown): UserPreset[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as {
    id?: unknown;
    name?: unknown;
    order?: unknown;
    enabled?: unknown;
  };
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !Array.isArray(record.order) ||
    !Array.isArray(record.enabled)
  ) {
    return [];
  }
  const order = record.order.filter(isOperationId);
  const enabled = record.enabled.filter(isOperationId);
  if (!record.name.trim() || order.length === 0) {
    return [];
  }
  return [{ id: record.id, name: record.name.trim(), order, enabled }];
}

function parseActivePreset(
  value: unknown,
): (PresetSnapshot & { id: string }) | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { id?: unknown; order?: unknown; enabled?: unknown };
  if (
    typeof record.id !== "string" ||
    !Array.isArray(record.order) ||
    !Array.isArray(record.enabled)
  ) {
    return undefined;
  }
  return {
    id: record.id,
    order: record.order.filter(isOperationId),
    enabled: record.enabled.filter(isOperationId),
  };
}
