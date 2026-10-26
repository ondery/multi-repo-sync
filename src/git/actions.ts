import * as vscode from "vscode";
import type { GitRepository } from "./types";
import type { ChangeNode } from "../views/nodes";

export async function checkoutRef(
  repo: GitRepository,
  name: string,
  remote: boolean,
): Promise<void> {
  if (!remote) {
    await repo.checkout(name);
    return;
  }
  const slash = name.indexOf("/");
  const short = slash === -1 ? name : name.slice(slash + 1);
  const heads = await repo.getRefs({ pattern: "refs/heads", count: 500 });
  if (heads.some((ref) => ref.name === short)) {
    await repo.checkout(short);
    return;
  }
  await repo.createBranch(short, true, name);
}

export async function openChange(node: ChangeNode): Promise<void> {
  const right = vscode.Uri.file(node.fsPath);
  if (node.untracked || !node.originalUri) {
    await vscode.commands.executeCommand("vscode.open", right);
    return;
  }
  await vscode.commands.executeCommand(
    "vscode.diff",
    vscode.Uri.parse(node.originalUri),
    right,
    node.label,
  );
}

export async function discardPaths(
  repo: GitRepository,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const staged = new Set(
    repo.state.indexChanges.map((change) => change.uri.fsPath),
  );
  const toUnstage = paths.filter((path) => staged.has(path));
  if (toUnstage.length > 0) {
    // clean() only sees the working tree, so staged edits have to be unstaged first.
    await repo.revert(toUnstage);
    await repo.status();
  }
  await repo.clean([...paths]);
}

export async function openExternal(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
}
