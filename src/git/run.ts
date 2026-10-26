import { spawn } from "node:child_process";
import type { CancellationToken } from "vscode";
import { loadGitExtension, whenGitReady } from "./api";

export async function gitExecutable(): Promise<string> {
  const extension = await loadGitExtension();
  if (!extension?.enabled) {
    throw new Error("Git is not available.");
  }
  const api = await whenGitReady(extension);
  const path = api?.git.path;
  if (!path) {
    throw new Error("Git is not available.");
  }
  return path;
}

export function runGit(
  root: string,
  git: string,
  args: readonly string[],
  token?: CancellationToken,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token?.isCancellationRequested) {
      reject(new Error("Run cancelled."));
      return;
    }
    const child = spawn(git, args, {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_EDITOR: "true",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    let stderr = "";
    child.stdout?.resume();
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const cancel = token?.onCancellationRequested(() => {
      child.kill();
    });
    child.on("error", (error) => {
      cancel?.dispose();
      reject(error);
    });
    child.on("close", (code) => {
      cancel?.dispose();
      if (token?.isCancellationRequested) {
        reject(new Error("Run cancelled."));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(
        new Error(detail || `git ${args[0] ?? "command"} exited with ${code}.`),
      );
    });
  });
}
