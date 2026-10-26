import assert from 'node:assert/strict';
import test from 'node:test';
import {
  branchNameOnGitHub,
  githubBranchUrl,
  githubCommitUrl,
  githubCompareUrl,
  githubRemote,
  parseGitHubRemote,
} from './remote';

test('parses GitHub remote URLs', () => {
  assert.deepEqual(parseGitHubRemote('https://github.com/octo/repo.git'), { owner: 'octo', repo: 'repo' });
  assert.deepEqual(parseGitHubRemote('https://github.com/octo/repo'), { owner: 'octo', repo: 'repo' });
  assert.deepEqual(parseGitHubRemote('https://www.github.com/octo/repo'), { owner: 'octo', repo: 'repo' });
  assert.deepEqual(parseGitHubRemote('git@github.com:octo/repo.git'), { owner: 'octo', repo: 'repo' });
  assert.deepEqual(parseGitHubRemote('ssh://git@github.com/octo/repo.git'), { owner: 'octo', repo: 'repo' });
  assert.deepEqual(parseGitHubRemote('https://github.com/octo/repo/pulls'), { owner: 'octo', repo: 'repo' });
  assert.deepEqual(parseGitHubRemote('https://user@github.com/octo/my.repo.git'), { owner: 'octo', repo: 'my.repo' });
});

test('rejects non-GitHub and empty remotes', () => {
  assert.equal(parseGitHubRemote('https://gitlab.com/octo/repo.git'), undefined);
  assert.equal(parseGitHubRemote('https://github.example.com/octo/repo.git'), undefined);
  assert.equal(parseGitHubRemote('git@gitlab.com:octo/repo.git'), undefined);
  assert.equal(parseGitHubRemote(''), undefined);
  assert.equal(parseGitHubRemote(undefined), undefined);
  assert.equal(parseGitHubRemote('not a url'), undefined);
});

test('prefers origin and falls back to another GitHub remote', () => {
  assert.deepEqual(
    githubRemote([
      { name: 'upstream', fetchUrl: 'https://github.com/other/repo.git' },
      { name: 'origin', fetchUrl: 'https://example.com/not/github.git', pushUrl: 'git@github.com:octo/repo.git' },
    ]),
    { remote: 'origin', repo: { owner: 'octo', repo: 'repo' } },
  );
  assert.equal(githubRemote([{ name: 'origin', fetchUrl: 'https://gitlab.com/octo/repo.git' }]), undefined);
});

test('builds GitHub links without encoding branch slashes as one piece', () => {
  const repo = { owner: 'octo', repo: 'repo' };
  assert.equal(githubCommitUrl(repo, 'abc123'), 'https://github.com/octo/repo/commit/abc123');
  assert.equal(githubBranchUrl(repo, 'feature/one'), 'https://github.com/octo/repo/tree/feature/one');
  assert.equal(githubCompareUrl(repo, 'main', 'feature/one'), 'https://github.com/octo/repo/compare/main...feature/one');
  assert.equal(branchNameOnGitHub('origin/feature/one', true), 'feature/one');
  assert.equal(branchNameOnGitHub('feature/one', false), 'feature/one');
});
