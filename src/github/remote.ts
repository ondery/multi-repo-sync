export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface NamedRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function parseGitHubRemote(url: string | undefined): GitHubRepoRef | undefined {
  if (!url) {
    return undefined;
  }
  const trimmed = url.trim();
  const scp = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(trimmed);
  if (scp) {
    return pair(scp[1], scp[2]);
  }
  const ssh = /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(trimmed);
  if (ssh) {
    return pair(ssh[1], ssh[2]);
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
      return undefined;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      return undefined;
    }
    return pair(decodeURIComponent(parts[0]), decodeURIComponent(parts[1].replace(/\.git$/i, '')));
  } catch {
    return undefined;
  }
}

export function githubRemote(remotes: readonly NamedRemote[]): { remote: string; repo: GitHubRepoRef } | undefined {
  const origin = remotes.find(remote => remote.name === 'origin');
  const ordered = origin ? [origin, ...remotes.filter(remote => remote !== origin)] : [...remotes];
  for (const remote of ordered) {
    const repo = parseGitHubRemote(remote.fetchUrl) ?? parseGitHubRemote(remote.pushUrl);
    if (repo) {
      return { remote: remote.name, repo };
    }
  }
  return undefined;
}

export function githubRepoUrl(repo: GitHubRepoRef): string {
  return `https://github.com/${encodeSegment(repo.owner)}/${encodeSegment(repo.repo)}`;
}

export function githubBranchUrl(repo: GitHubRepoRef, branch: string): string {
  return `${githubRepoUrl(repo)}/tree/${encodeRef(branch)}`;
}

export function githubCommitUrl(repo: GitHubRepoRef, hash: string): string {
  return `${githubRepoUrl(repo)}/commit/${encodeURIComponent(hash)}`;
}

export function githubCompareUrl(repo: GitHubRepoRef, base: string, head: string): string {
  return `${githubRepoUrl(repo)}/compare/${encodeRef(base)}...${encodeRef(head)}`;
}

export function githubTagUrl(repo: GitHubRepoRef, tag: string): string {
  return `${githubRepoUrl(repo)}/tree/${encodeRef(tag)}`;
}

export function branchNameOnGitHub(name: string, remote: boolean): string {
  if (!remote) {
    return name;
  }
  const index = name.indexOf('/');
  return index === -1 ? name : name.slice(index + 1);
}

function encodeRef(name: string): string {
  return name.split('/').map(part => encodeURIComponent(part)).join('/');
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function pair(owner: string, repo: string): GitHubRepoRef | undefined {
  const cleanRepo = repo.replace(/\.git$/i, '');
  if (!SEGMENT.test(owner) || !SEGMENT.test(cleanRepo)) {
    return undefined;
  }
  if (owner === '.' || owner === '..' || cleanRepo === '.' || cleanRepo === '..') {
    return undefined;
  }
  return { owner, repo: cleanRepo };
}
