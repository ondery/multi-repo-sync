import * as vscode from "vscode";
import {
  OPERATION_IDS,
  isDestructive,
  isOperationId,
} from "../pipeline/catalog";
import {
  operationDescription,
  operationIconName,
  operationLabel,
  operationTooltip,
} from "../pipeline/labels";
import { applyPreset, mergeOrder } from "../pipeline/order";
import {
  OPERATION_PRESETS,
  builtinPreset,
  normalizePresetName,
  presetNameTaken,
  sameSnapshot,
  snapshotFrom,
  type PresetSnapshot,
  type UserPreset,
} from "../pipeline/presets";
import type { RunProgress } from "../pipeline/runner";
import type { ExtensionState } from "../state/store";

interface ViewMessage {
  type?: string;
  id?: string;
  enabled?: boolean;
  order?: unknown;
}

export class OperationsView
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private running = false;
  private runProgress: RunProgress | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: ExtensionState,
  ) {}

  setRunning(running: boolean, progress?: RunProgress): void {
    this.running = running;
    this.runProgress = running ? progress : undefined;
    this.postState();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.onMessage(message as ViewMessage);
      }),
    );
    this.disposables.push(
      webviewView.onDidDispose(() => {
        this.view = undefined;
      }),
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async onMessage(message: ViewMessage): Promise<void> {
    if (message.type === "ready") {
      this.postState();
      return;
    }
    if (message.type === "run") {
      await vscode.commands.executeCommand(
        this.running ? "multiRepoSync.stop" : "multiRepoSync.start",
      );
      return;
    }
    if (this.running) {
      return;
    }
    if (
      message.type === "toggle" &&
      message.id &&
      isOperationId(message.id) &&
      typeof message.enabled === "boolean"
    ) {
      await this.store.setOperationEnabled(message.id, message.enabled);
      this.postState();
      return;
    }
    if (message.type === "reorder" && Array.isArray(message.order)) {
      const requested = message.order.filter(isOperationId);
      const order = mergeOrder(requested, OPERATION_IDS).filter(isOperationId);
      await this.store.setOperationOrder(order);
      this.postState();
      return;
    }
    if (message.type === "preset" && message.id) {
      await this.applyNamedPreset(message.id);
      return;
    }
    if (message.type === "save") {
      await this.savePreset();
      return;
    }
    if (message.type === "saveAs") {
      await this.savePresetAs();
      return;
    }
    if (message.type === "rename") {
      await this.renamePreset();
      return;
    }
    if (message.type === "delete") {
      await this.deletePreset();
    }
  }

  private async applyNamedPreset(id: string): Promise<void> {
    const snapshot = this.snapshotFor(id);
    if (!snapshot) {
      return;
    }
    await this.store.setOperationOrder(snapshot.order.filter(isOperationId));
    await this.store.setEnabledOperations(
      snapshot.enabled.filter(isOperationId),
    );
    await this.store.setActivePreset(id, snapshot);
    this.postState();
  }

  private snapshotFor(id: string): PresetSnapshot | undefined {
    const builtin = builtinPreset(id);
    if (builtin) {
      const applied = applyPreset(
        this.store.operationOrder(),
        builtin.operations,
      );
      return snapshotFrom(applied.order, applied.enabled);
    }
    const user = this.store.userPresets().find((preset) => preset.id === id);
    if (!user) {
      return undefined;
    }
    const order = mergeOrder(user.order, OPERATION_IDS).filter(isOperationId);
    return snapshotFrom(order, user.enabled);
  }

  private async savePreset(): Promise<void> {
    const active = this.currentUserPreset();
    if (!active) {
      await this.savePresetAs();
      return;
    }
    const snapshot = this.currentSnapshot();
    await this.store.saveUserPreset({
      ...active,
      order: snapshot.order,
      enabled: snapshot.enabled,
    });
    await this.store.setActivePreset(active.id, snapshot);
    this.postState();
  }

  private async savePresetAs(): Promise<void> {
    const name = await this.askName(vscode.l10n.t("Save preset"));
    if (!name) {
      return;
    }
    const snapshot = this.currentSnapshot();
    const preset: UserPreset = {
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      order: snapshot.order,
      enabled: snapshot.enabled,
    };
    await this.store.saveUserPreset(preset);
    await this.store.setActivePreset(preset.id, snapshot);
    this.postState();
  }

  private async renamePreset(): Promise<void> {
    const active = this.currentUserPreset();
    if (!active) {
      return;
    }
    const name = await this.askName(
      vscode.l10n.t("Rename preset"),
      active.name,
      active.id,
    );
    if (!name) {
      return;
    }
    await this.store.renameUserPreset(active.id, name);
    this.postState();
  }

  private async deletePreset(): Promise<void> {
    const active = this.currentUserPreset();
    if (!active) {
      return;
    }
    const remove = vscode.l10n.t("Delete");
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t("Delete preset {0}?", active.name),
      { modal: true },
      remove,
    );
    if (choice !== remove) {
      return;
    }
    await this.store.deleteUserPreset(active.id);
    this.postState();
  }

  private currentUserPreset(): UserPreset | undefined {
    const id = this.store.activePreset()?.id;
    if (!id || builtinPreset(id)) {
      return undefined;
    }
    return this.store.userPresets().find((preset) => preset.id === id);
  }

  private currentSnapshot(): PresetSnapshot {
    return snapshotFrom(
      this.store.operationOrder(),
      this.store.enabledOperations(),
    );
  }

  private async askName(
    title: string,
    value = "",
    exceptId?: string,
  ): Promise<string | undefined> {
    const entered = await vscode.window.showInputBox({
      title,
      value,
      ignoreFocusOut: true,
      prompt: vscode.l10n.t("Preset name"),
    });
    if (entered === undefined) {
      return undefined;
    }
    const name = normalizePresetName(entered);
    if (!name) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t("Enter a preset name."),
      );
      return undefined;
    }
    const reserved = [
      ...OPERATION_PRESETS.map((preset) => ({
        id: preset.id,
        name: presetLabel(preset.id),
      })),
      ...this.store.userPresets(),
    ];
    if (presetNameTaken(name, reserved, exceptId)) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t("A preset named {0} already exists.", name),
      );
      return undefined;
    }
    return name;
  }

  private postState(): void {
    const snapshot = this.currentSnapshot();
    const active = this.store.activePreset();
    const activeKnown =
      active !== undefined &&
      (builtinPreset(active.id) !== undefined ||
        this.store.userPresets().some((preset) => preset.id === active.id));
    const dirty = Boolean(
      active && activeKnown && !sameSnapshot(snapshot, active),
    );
    const userActive = Boolean(
      active && activeKnown && !builtinPreset(active.id),
    );
    const enabled = new Set(snapshot.enabled);
    const items = snapshot.order.filter(isOperationId).map((id) => ({
      id,
      label: operationLabel(id),
      description: operationDescription(id) ?? "",
      tooltip: operationTooltip(id),
      icon: operationIconName(id),
      destructive: isDestructive(id),
      enabled: enabled.has(id),
    }));
    const builtins = OPERATION_PRESETS.map((preset) => ({
      id: preset.id,
      name: presetLabel(preset.id),
      builtin: true,
    }));
    const users = this.store
      .userPresets()
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((preset) => ({ id: preset.id, name: preset.name, builtin: false }));
    void this.view?.webview.postMessage({
      type: "state",
      items,
      presets: [...builtins, ...users],
      activePresetId: activeKnown ? active.id : "",
      dirty,
      canSave: dirty,
      canRename: Boolean(userActive),
      canDelete: Boolean(userActive),
      running: this.running,
      progress: this.runProgress ?? null,
      hint: vscode.l10n.t(
        "Checked steps run in order on the selected repositories. Sync is only one step.",
      ),
      unsavedLabel: dirty ? vscode.l10n.t("Unsaved preset changes") : "",
      labels: {
        presets: vscode.l10n.t("Preset"),
        placeholder: vscode.l10n.t("Select a preset"),
        builtin: vscode.l10n.t("Built-in"),
        mine: vscode.l10n.t("My presets"),
        save: vscode.l10n.t("Save"),
        saveAs: vscode.l10n.t("Save As"),
        rename: vscode.l10n.t("Rename"),
        delete: vscode.l10n.t("Delete"),
        start: vscode.l10n.t("Start"),
        stop: vscode.l10n.t("Stop"),
        drag: vscode.l10n.t("Drag to reorder"),
      },
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = createNonce();
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "operations.js"),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "operations.css"),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
  <title>Operations</title>
</head>
<body>
  <div class="page">
    <p id="hint" class="hint"></p>
    <div class="preset-block">
      <label id="presets-label" class="preset-label" for="preset-select"></label>
      <select id="preset-select"></select>
      <div id="unsaved" class="unsaved"></div>
      <div class="preset-actions">
        <button id="preset-save" type="button"></button>
        <button id="preset-save-as" type="button"></button>
        <button id="preset-rename" type="button"></button>
        <button id="preset-delete" type="button"></button>
      </div>
    </div>
    <div id="list" class="list"></div>
    <div class="footer">
      <div id="progress-wrap" class="progress-wrap">
        <div id="progress-label" class="progress-label"></div>
        <progress id="run-progress" max="1" value="0"></progress>
      </div>
      <button id="run" class="run" type="button"></button>
    </div>
  </div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function presetLabel(id: string): string {
  switch (id) {
    case "fetch":
      return vscode.l10n.t("Fetch");
    case "pull":
      return vscode.l10n.t("Pull");
    case "sync":
      return vscode.l10n.t("Sync");
    case "stageCommitPush":
      return vscode.l10n.t("Stage, commit, and push");
    case "commitPush":
      return vscode.l10n.t("Commit and push");
    case "publish":
      return vscode.l10n.t("Publish Branch");
    case "pullRequest":
      return vscode.l10n.t("Pull request");
    default:
      return id;
  }
}

function createNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 24 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}
