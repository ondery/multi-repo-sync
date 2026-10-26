import type { GitRepository } from '../git/types';
import { githubRemote } from './remote';

export async function detectDefaultBranch(repo: GitRepository): Promise<string | undefined> {
  const remoteName = githubRemote(repo.state.remotes)?.remote ?? repo.state.remotes[0]?.name ?? 'origin';
  try {
    const symbolic = await repo.getBranch(`${remoteName}/HEAD`);
    const name = symbolic.name?.replace(new RegExp(`^${escapeRegExp(remoteName)}/`), '');
    if (name && name !== 'HEAD') {
      return name;
    }
  } catch {
    // Some clones have no symbolic origin/HEAD.
  }

  let names: string[] = [];
  try {
    const refs = await repo.getRefs({ pattern: `refs/remotes/${remoteName}`, count: 200 });
    names = refs
      .map(ref => ref.name?.replace(new RegExp(`^${escapeRegExp(remoteName)}/`), ''))
      .filter((name): name is string => Boolean(name) && name !== 'HEAD');
  } catch {
    names = [];
  }

  for (const candidate of ['main', 'master', 'trunk', 'develop']) {
    if (names.includes(candidate)) {
      return candidate;
    }
  }
  return names[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
