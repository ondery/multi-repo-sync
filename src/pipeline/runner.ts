import * as vscode from "vscode";
import type { GitRepository } from "../git/types";
import type { RepoModel } from "../repos/model";
import type { ExtensionState } from "../state/store";
import { errorMessage } from "../util/error";
import { normalizeKey } from "../util/path";
import { executeOperation, type StepOutcome } from "./execute";
import { operationLabel } from "./labels";
import { expandSteps } from "./order";
import { readRunSettings } from "./settings";
import { RunSession } from "./session";
import type { OperationId } from "./catalog";

export interface RunProgress {
  current: number;
  total: number;
  label: string;
  operationId: string;
}

export interface RunSurface {
  setRunning(running: boolean, progress?: RunProgress): void;
}

export class PipelineRunner {
  private running = false;
  private cancellation: vscode.CancellationTokenSource | undefined;

  constructor(
    private readonly model: RepoModel,
    private readonly store: ExtensionState,
    private readonly output: vscode.OutputChannel,
    private readonly surface: RunSurface,
  ) {}

  stop(): void {
    this.cancellation?.cancel();
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    const repos = this.model
      .list()
      .filter((repo) => this.store.isSelected(repo.rootUri.fsPath));
    const enabled = new Set(this.store.enabledOperations());
    const operations = this.store
      .operationOrder()
      .filter((id) => enabled.has(id));
    if (repos.length === 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t("Select at least one repository."),
      );
      return;
    }
    if (operations.length === 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t("Select at least one step."),
      );
      return;
    }

    const settings = readRunSettings();
    const steps = expandSteps(
      repos.map((repo) => repo.rootUri.fsPath),
      operations,
      settings.order,
    );
    const session = new RunSession();
    const skippedRoots = new Set<string>();
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    let stopped = false;

    this.running = true;
    this.cancellation = new vscode.CancellationTokenSource();
    const token = this.cancellation.token;
    this.setRunningContext(true);
    this.surface.setRunning(true);
    this.output.appendLine(
      vscode.l10n.t(
        "--- Run started ({0} repositories, {1} steps) ---",
        repos.length,
        operations.length,
      ),
    );

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Multi Repo Sync",
          cancellable: true,
        },
        async (progress, progressToken) => {
          const linked = progressToken.onCancellationRequested(() =>
            this.cancellation?.cancel(),
          );
          let reported = 0;
          let index = 0;
          const report = (
            current: number,
            name: string,
            label: string,
            operationId: string,
          ) => {
            const target =
              steps.length === 0
                ? 100
                : Math.min(100, Math.round((current / steps.length) * 100));
            const increment = Math.max(0, target - reported);
            reported = target;
            progress.report({
              message: vscode.l10n.t(
                "{0}/{1} · {2} · {3}",
                current,
                steps.length,
                name,
                label,
              ),
              increment,
            });
            this.surface.setRunning(true, {
              current,
              total: steps.length,
              label: vscode.l10n.t("{0} · {1}", name, label),
              operationId,
            });
          };
          try {
            while (index < steps.length) {
              if (token.isCancellationRequested) {
                stopped = true;
                this.output.appendLine(vscode.l10n.t("Run cancelled."));
                break;
              }
              const step = steps[index];
              const key = normalizeKey(step.root);
              if (skippedRoots.has(key)) {
                report(
                  index + 1,
                  this.model.label(step.root),
                  operationLabel(step.operation),
                  step.operation,
                );
                index += 1;
                continue;
              }
              const repo = this.model.find(step.root);
              const label = operationLabel(step.operation);
              const name = this.model.label(step.root);
              if (!repo) {
                skipped += 1;
                this.log(
                  name,
                  label,
                  vscode.l10n.t("skipped"),
                  vscode.l10n.t("Repository is no longer open."),
                );
                report(index + 1, name, label, step.operation);
                index += 1;
                continue;
              }

              report(index + 1, name, label, step.operation);
              const outcome = await this.runStep(
                step.operation,
                repo,
                session,
                token,
                repos,
              );
              const decision = await this.handleOutcome(
                outcome,
                token,
                name,
                label,
                key,
                skippedRoots,
                settings.onError,
              );
              if (decision.action === "retry") {
                continue;
              }
              succeeded += decision.succeeded;
              skipped += decision.skipped;
              failed += decision.failed;
              if (decision.action === "stop") {
                stopped = true;
                break;
              }
              index += 1;
            }
          } finally {
            if (index >= steps.length) {
              progress.report({ increment: Math.max(0, 100 - reported) });
            }
            linked.dispose();
          }
        },
      );
    } finally {
      this.running = false;
      this.cancellation?.dispose();
      this.cancellation = undefined;
      this.setRunningContext(false);
      this.surface.setRunning(false);
      this.output.appendLine(
        vscode.l10n.t(
          "--- Run finished. Succeeded: {0}, skipped: {1}, failed: {2} ---",
          succeeded,
          skipped,
          failed,
        ),
      );
      this.summarize(stopped, succeeded, skipped, failed);
    }
  }

  private async runStep(
    operation: OperationId,
    repo: GitRepository,
    session: RunSession,
    token: vscode.CancellationToken,
    peers: readonly GitRepository[],
  ): Promise<StepOutcome> {
    try {
      return await executeOperation(operation, repo, session, token, peers);
    } catch (error) {
      return { status: "failed", detail: errorMessage(error) };
    }
  }

  private async handleOutcome(
    outcome: StepOutcome,
    token: vscode.CancellationToken,
    name: string,
    label: string,
    key: string,
    skippedRoots: Set<string>,
    onError: "stop" | "skipRepository" | "continue",
  ): Promise<{
    action: "next" | "stop" | "retry";
    succeeded: number;
    skipped: number;
    failed: number;
  }> {
    if (outcome.needsChoice && !token.isCancellationRequested) {
      this.log(name, label, vscode.l10n.t("cancelled"), outcome.detail);
      const choice = await this.askCommitChoice(name);
      if (choice === "retry") {
        return { action: "retry", succeeded: 0, skipped: 0, failed: 0 };
      }
      if (choice === "skip") {
        skippedRoots.add(key);
        this.output.appendLine(
          vscode.l10n.t("Skipping remaining steps for {0}.", name),
        );
        return { action: "next", succeeded: 0, skipped: 1, failed: 0 };
      }
      return { action: "stop", succeeded: 0, skipped: 0, failed: 0 };
    }

    if (
      outcome.stopRun ||
      (token.isCancellationRequested && outcome.status !== "ok")
    ) {
      this.log(
        name,
        label,
        vscode.l10n.t("cancelled"),
        outcome.detail ?? vscode.l10n.t("Run cancelled."),
      );
      return { action: "stop", succeeded: 0, skipped: 0, failed: 0 };
    }

    if (outcome.status === "failed") {
      this.log(name, label, vscode.l10n.t("failed"), outcome.detail);
      if (onError === "continue") {
        return { action: "next", succeeded: 0, skipped: 0, failed: 1 };
      }
      if (onError === "skipRepository") {
        skippedRoots.add(key);
        this.output.appendLine(
          vscode.l10n.t("Skipping remaining steps for {0}.", name),
        );
        return { action: "next", succeeded: 0, skipped: 0, failed: 1 };
      }
      return { action: "stop", succeeded: 0, skipped: 0, failed: 1 };
    }

    if (outcome.status === "skipped") {
      this.log(name, label, vscode.l10n.t("skipped"), outcome.detail);
      return { action: "next", succeeded: 0, skipped: 1, failed: 0 };
    }
    if (outcome.status === "cancelled") {
      this.log(name, label, vscode.l10n.t("cancelled"), outcome.detail);
      return { action: "stop", succeeded: 0, skipped: 0, failed: 0 };
    }
    this.log(name, label, vscode.l10n.t("ok"), outcome.detail);
    return { action: "next", succeeded: 1, skipped: 0, failed: 0 };
  }

  private async askCommitChoice(
    name: string,
  ): Promise<"stop" | "skip" | "retry"> {
    const stop = vscode.l10n.t("Stop");
    const skip = vscode.l10n.t("Skip Repository");
    const retry = vscode.l10n.t("Retry");
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t("Commit was not created for {0}.", name),
      { modal: true },
      stop,
      skip,
      retry,
    );
    if (choice === retry) {
      return "retry";
    }
    if (choice === skip) {
      return "skip";
    }
    return "stop";
  }

  private summarize(
    stopped: boolean,
    succeeded: number,
    skipped: number,
    failed: number,
  ): void {
    if (failed > 0) {
      this.output.show(true);
    }
    if (stopped) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t(
          "Multi Repo Sync stopped. Succeeded: {0}, skipped: {1}, failed: {2}.",
          succeeded,
          skipped,
          failed,
        ),
      );
      return;
    }
    if (failed > 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Multi Repo Sync finished with failures. Succeeded: {0}, skipped: {1}, failed: {2}.",
          succeeded,
          skipped,
          failed,
        ),
      );
      return;
    }
    void vscode.window.showInformationMessage(
      vscode.l10n.t(
        "Multi Repo Sync finished. Succeeded: {0}, skipped: {1}.",
        succeeded,
        skipped,
      ),
    );
  }

  private log(
    repo: string,
    operation: string,
    status: string,
    detail?: string,
  ): void {
    const time = new Date().toLocaleTimeString();
    const suffix = detail ? `  ${detail}` : "";
    this.output.appendLine(
      `${time}  ${repo}  ${operation}  ${status}${suffix}`,
    );
  }

  private setRunningContext(running: boolean): void {
    void vscode.commands.executeCommand(
      "setContext",
      "multiRepoSync.running",
      running,
    );
  }
}
