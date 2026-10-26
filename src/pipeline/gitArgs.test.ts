import assert from "node:assert/strict";
import test from "node:test";
import {
  commitArgs,
  fetchArgs,
  pullArgs,
  pushArgs,
  rebaseArgs,
  stashArgs,
  syncArgs,
} from "./gitArgs";

const tracked = { name: "main", upstream: { remote: "origin", name: "main" } };

test("fetch names one remote and does not pull or push", () => {
  assert.deepEqual(fetchArgs("origin"), ["fetch", "origin"]);
  assert.deepEqual(fetchArgs(undefined), ["fetch"]);
});

test("pull updates the current branch and does not push", () => {
  assert.deepEqual(pullArgs(), ["-c", "core.editor=true", "pull", "--no-edit"]);
  assert.equal(pullArgs().includes("push"), false);
});

test("push sends the local branch to its upstream and does not pull", () => {
  assert.deepEqual(pushArgs(tracked), ["push", "origin", "main:main"]);
  assert.deepEqual(pushArgs({ name: "main" }), ["push"]);
});

test("publish sets upstream for the named branch", () => {
  assert.deepEqual(
    pushArgs({ name: "feature" }, { remote: "origin", setUpstream: true }),
    ["push", "--set-upstream", "origin", "feature:feature"],
  );
});

test("force push uses lease and the upstream refspec", () => {
  assert.deepEqual(pushArgs(tracked, { forceWithLease: true }), [
    "push",
    "--force-with-lease",
    "origin",
    "main:main",
  ]);
});

test("sync is pull followed by push", () => {
  assert.deepEqual(syncArgs(tracked), [
    ["-c", "core.editor=true", "pull", "--no-edit"],
    ["push", "origin", "main:main"],
  ]);
});

test("commit only commits the prepared message", () => {
  const args = commitArgs("Ship the panel");
  assert.deepEqual(args, ["commit", "-m", "Ship the panel"]);
  assert.equal(args.includes("pull"), false);
  assert.equal(args.includes("push"), false);
});

test("stash and rebase stay on those commands", () => {
  assert.deepEqual(stashArgs(), ["stash", "push", "--include-untracked"]);
  assert.deepEqual(rebaseArgs("origin/main"), ["rebase", "--", "origin/main"]);
});
