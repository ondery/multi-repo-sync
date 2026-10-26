import type { GitHubRepoRef } from './remote';

export interface GitHubPullRequest {
  number: number;
  title: string;
  url: string;
  head: string;
}

interface GitHubPullResponse {
  number?: number;
  title?: string;
  html_url?: string;
  head?: { ref?: string };
  message?: string;
}

const API = 'https://api.github.com';

export async function listOpenPullRequests(token: string, repo: GitHubRepoRef): Promise<GitHubPullRequest[]> {
  const response = await request(token, `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls?state=open&per_page=30`);
  const body = await readJson<GitHubPullResponse[]>(response);
  if (!Array.isArray(body)) {
    return [];
  }
  return body.flatMap(item => {
    if (!item.number || !item.title || !item.html_url || !item.head?.ref) {
      return [];
    }
    return [{ number: item.number, title: item.title, url: item.html_url, head: item.head.ref }];
  });
}

export async function createPullRequest(input: {
  token: string;
  repo: GitHubRepoRef;
  title: string;
  head: string;
  base: string;
  body: string;
}): Promise<GitHubPullRequest> {
  const response = await request(
    input.token,
    `/repos/${encodeURIComponent(input.repo.owner)}/${encodeURIComponent(input.repo.repo)}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
      }),
    },
  );
  const payload = await readJson<GitHubPullResponse>(response);
  if (!payload.number || !payload.html_url || !payload.head?.ref) {
    throw new Error(payload.message || 'GitHub did not return a pull request.');
  }
  return {
    number: payload.number,
    title: payload.title || input.title,
    url: payload.html_url,
    head: payload.head.ref,
  };
}

async function request(token: string, path: string, init?: { method?: string; body?: string }): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'multi-repo-sync',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body,
  });
  if (!response.ok) {
    const detail = await response.text();
    let message = `GitHub request failed (${response.status}).`;
    try {
      const parsed = JSON.parse(detail) as { message?: string };
      if (parsed.message) {
        message = parsed.message;
      }
    } catch {
      if (detail.trim()) {
        message = detail.trim();
      }
    }
    throw new Error(message);
  }
  return response;
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
