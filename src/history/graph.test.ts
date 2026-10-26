import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutGraph } from './graph';

test('linear history stays on the first lane', () => {
  const rows = layoutGraph([
    { hash: 'a', parents: ['b'] },
    { hash: 'b', parents: ['c'] },
    { hash: 'c', parents: [] },
  ]);
  assert.deepEqual(rows.map(row => row.lane), [0, 0, 0]);
  assert.deepEqual(rows.map(row => row.fromAbove), [false, true, true]);
  assert.deepEqual(rows[0].parentLanes, [0]);
  assert.deepEqual(rows[2].parentLanes, []);
});

test('a merge opens a second lane and joins it back', () => {
  const rows = layoutGraph([
    { hash: 'm', parents: ['a', 'b'] },
    { hash: 'a', parents: ['c'] },
    { hash: 'b', parents: ['c'] },
    { hash: 'c', parents: [] },
  ]);
  assert.equal(rows[0].lane, 0);
  assert.deepEqual(rows[0].parentLanes, [0, 1]);
  assert.equal(rows[1].lane, 0);
  assert.ok(rows[1].through.includes(1));
  assert.equal(rows[2].lane, 1);
  assert.deepEqual(rows[2].parentLanes, [0]);
  assert.equal(rows[3].lane, 0);
  assert.equal(rows[3].fromAbove, true);
});

test('two tips that share a parent use two lanes', () => {
  const rows = layoutGraph([
    { hash: 'a', parents: ['c'] },
    { hash: 'b', parents: ['c'] },
    { hash: 'c', parents: [] },
  ]);
  assert.equal(rows[0].lane, 0);
  assert.equal(rows[1].lane, 1);
  assert.deepEqual(rows[1].parentLanes, [0]);
  assert.ok(rows[1].through.includes(0));
  assert.equal(rows[2].lane, 0);
});

test('every lane index fits the row width', () => {
  const rows = layoutGraph([
    { hash: 'm', parents: ['a', 'b'] },
    { hash: 'a', parents: ['c'] },
    { hash: 'b', parents: ['d'] },
    { hash: 'c', parents: [] },
    { hash: 'd', parents: [] },
  ]);
  for (const row of rows) {
    assert.ok(row.lane < row.laneCount);
    for (const parent of row.parentLanes) {
      assert.ok(parent < row.laneCount);
    }
    for (const through of row.through) {
      assert.ok(through < row.laneCount);
    }
  }
});
