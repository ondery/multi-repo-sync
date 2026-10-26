import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePresetName,
  presetNameTaken,
  removePreset,
  renamePreset,
  sameSnapshot,
  snapshotFrom,
  upsertPreset,
  type UserPreset,
} from './presets';

test('normalizePresetName trims and collapses spaces', () => {
  assert.equal(normalizePresetName('  My   preset  '), 'My preset');
});

test('preset names are unique without regard to case', () => {
  const presets = [{ id: 'a', name: 'Sync' }, { id: 'b', name: 'Nightly' }];
  assert.equal(presetNameTaken(' sync ', presets), true);
  assert.equal(presetNameTaken('Sync', presets, 'a'), false);
  assert.equal(presetNameTaken('Release', presets), false);
});

test('snapshot enabled ids follow the current order', () => {
  assert.deepEqual(snapshotFrom(['push', 'commit', 'fetch'], ['fetch', 'commit']), {
    order: ['push', 'commit', 'fetch'],
    enabled: ['commit', 'fetch'],
  });
  assert.equal(
    sameSnapshot(
      snapshotFrom(['a', 'b'], ['b']),
      { order: ['a', 'b'], enabled: ['b'] },
    ),
    true,
  );
  assert.equal(
    sameSnapshot(
      snapshotFrom(['a', 'b'], ['a']),
      { order: ['b', 'a'], enabled: ['a'] },
    ),
    false,
  );
});

test('user presets can be created, renamed, and deleted', () => {
  const created: UserPreset = { id: 'user-1', name: 'Release', order: ['commit', 'push'], enabled: ['commit', 'push'] };
  const saved = upsertPreset([], created);
  const renamed = renamePreset(saved, 'user-1', 'Ship');
  assert.equal(renamed[0]?.name, 'Ship');
  const replaced = upsertPreset(renamed, { ...created, name: 'Ship', enabled: ['push'] });
  assert.equal(replaced.length, 1);
  assert.deepEqual(replaced[0]?.enabled, ['push']);
  assert.deepEqual(removePreset(replaced, 'user-1'), []);
});
