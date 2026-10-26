export interface BranchHead {
  name: string;
  upstream?: { remote: string; name: string };
}

export interface PushOptions {
  remote?: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
}

/** Fetch only. Does not merge and does not push. */
export function fetchArgs(remote: string | undefined): string[] {
  return remote ? ["fetch", remote] : ["fetch"];
}

/** Pull only. Does not push. */
export function pullArgs(): string[] {
  return ["-c", "core.editor=true", "pull", "--no-edit"];
}

/**
 * Push only. A rejected push stays a failed push.
 * The refspec is local:remote so Git does not pull first.
 */
export function pushArgs(
  head: BranchHead,
  options: PushOptions = {},
): string[] {
  const args = ["push"];
  if (options.forceWithLease) {
    args.push("--force-with-lease");
  }
  if (options.setUpstream) {
    args.push("--set-upstream");
  }
  const remote = options.remote ?? head.upstream?.remote;
  if (!remote) {
    return args;
  }
  const destination =
    head.upstream && head.upstream.remote === remote
      ? head.upstream.name
      : head.name;
  args.push(remote, `${head.name}:${destination}`);
  return args;
}

/** The only sequence that both pulls and pushes, in that order. */
export function syncArgs(head: BranchHead): string[][] {
  return [pullArgs(), pushArgs(head)];
}

export function commitArgs(message: string): string[] {
  return ["commit", "-m", message];
}

export function stashArgs(): string[] {
  return ["stash", "push", "--include-untracked"];
}

export function stashPopArgs(): string[] {
  return ["stash", "pop"];
}

export function rebaseArgs(onto: string): string[] {
  return ["rebase", "--", onto];
}

export function rebaseAbortArgs(): string[] {
  return ["rebase", "--abort"];
}
