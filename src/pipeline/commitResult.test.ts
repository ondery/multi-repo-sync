import assert from 'node:assert/strict';
import test from 'node:test';
import { commitWasCreated, interpretCommitResult } from './commitResult';

test('a new HEAD hash means the commit was created', () => {
  assert.equal(commitWasCreated('aaa', 'bbb'), true);
  assert.equal(commitWasCreated(undefined, 'bbb'), true);
  assert.equal(commitWasCreated('aaa', 'aaa'), false);
  assert.equal(commitWasCreated('aaa', undefined), false);
  assert.equal(commitWasCreated(undefined, ''), false);
});

test('an unchanged HEAD with no changes is skipped', () => {
  assert.equal(interpretCommitResult({ before: 'aaa', after: 'aaa', hadChanges: false }), 'skipped');
});

test('an unchanged HEAD with changes is a cancelled message', () => {
  assert.equal(interpretCommitResult({ before: 'aaa', after: 'aaa', hadChanges: true }), 'cancelled');
  assert.equal(interpretCommitResult({ before: undefined, after: undefined, hadChanges: true }), 'cancelled');
});

test('a changed HEAD is success even when the tree was clean', () => {
  assert.equal(interpretCommitResult({ before: 'aaa', after: 'bbb', hadChanges: false }), 'ok');
});
