import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPreset,
  expandSteps,
  mergeOrder,
  moveItem,
  placeGenerateCommitMessage,
  reorderBefore,
} from "./order";

test("perRepository runs every step inside one repository first", () => {
  assert.deepEqual(
    expandSteps(["a", "b"], ["fetch", "pull"], "perRepository"),
    [
      { root: "a", operation: "fetch" },
      { root: "a", operation: "pull" },
      { root: "b", operation: "fetch" },
      { root: "b", operation: "pull" },
    ],
  );
});

test("perOperation runs one step across every repository first", () => {
  assert.deepEqual(expandSteps(["a", "b"], ["fetch", "pull"], "perOperation"), [
    { root: "a", operation: "fetch" },
    { root: "b", operation: "fetch" },
    { root: "a", operation: "pull" },
    { root: "b", operation: "pull" },
  ]);
});

test("expandSteps returns nothing when a side is empty", () => {
  assert.deepEqual(expandSteps([], ["fetch"], "perRepository"), []);
  assert.deepEqual(expandSteps(["a"], [], "perOperation"), []);
});

test("mergeOrder keeps a saved order and appends new steps", () => {
  assert.deepEqual(
    mergeOrder(["pull", "missing", "fetch", "pull"], ["fetch", "pull", "push"]),
    ["pull", "fetch", "push"],
  );
});

test("mergeOrder uses the catalog when nothing was saved", () => {
  assert.deepEqual(mergeOrder(undefined, ["fetch", "commit"]), [
    "fetch",
    "commit",
  ]);
});

test("moveItem swaps with the neighbor and ignores the ends", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveItem(["a", "b"], "a", -1), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], "missing", 1), ["a", "b"]);
});

test("reorderBefore inserts the dragged steps before the target", () => {
  assert.deepEqual(reorderBefore(["fetch", "pull", "push"], ["push"], "pull"), [
    "fetch",
    "push",
    "pull",
  ]);
  assert.deepEqual(
    reorderBefore(["fetch", "pull", "push"], ["fetch"], undefined),
    ["pull", "push", "fetch"],
  );
  assert.deepEqual(
    reorderBefore(["fetch", "pull", "push"], ["pull", "push"], "fetch"),
    ["pull", "push", "fetch"],
  );
  assert.deepEqual(reorderBefore(["fetch", "pull"], ["pull"], "pull"), [
    "fetch",
    "pull",
  ]);
});

test("a new generate step is inserted before commit until the user saves an order", () => {
  assert.deepEqual(
    placeGenerateCommitMessage(
      ["stageAll", "commit", "push"],
      ["stageAll", "commit", "push", "generateCommitMessage"],
    ),
    ["stageAll", "generateCommitMessage", "commit", "push"],
  );
  assert.deepEqual(
    placeGenerateCommitMessage(
      ["commit", "generateCommitMessage"],
      ["commit", "generateCommitMessage"],
    ),
    ["commit", "generateCommitMessage"],
  );
});

test("applyPreset checks the preset steps and moves them to the front", () => {
  assert.deepEqual(
    applyPreset(
      ["fetch", "pull", "commit", "push", "stash"],
      ["commit", "push"],
    ),
    {
      order: ["commit", "push", "fetch", "pull", "stash"],
      enabled: ["commit", "push"],
    },
  );
  assert.deepEqual(applyPreset(["push", "fetch"], ["missing", "fetch"]), {
    order: ["fetch", "push"],
    enabled: ["fetch"],
  });
});
