import assert from "node:assert/strict";
import test from "node:test";
import { checkReleaseBaseline, parseBaselineArguments } from "./check-release-baseline.mjs";

const baseline = "a".repeat(40);
const head = "b".repeat(40);
function fakeGit({ ancestorStatus = 0, dirty = false, error = false, checkedOut = head } = {}) {
  return (args) => {
    if (error) return { status: null, error: new Error("unavailable") };
    if (args[0] === "merge-base") return { status: ancestorStatus, stdout: "" };
    if (args[0] === "status") return { status: 0, stdout: dirty ? "?? local-draft.ts\n" : "" };
    if (args[0] === "rev-parse") {
      return { status: 0, stdout: args[2] === `${baseline}^{commit}` ? baseline : args[2] === "HEAD^{commit}" ? checkedOut : head };
    }
    throw new Error("unexpected_git_call");
  };
}

test("a clean descendant of the live build passes without any network access", () => {
  assert.deepEqual(checkReleaseBaseline({ liveBuildId: baseline, runGit: fakeGit() }), {
    baselineSha: baseline, candidateSha: head, includesLiveRelease: true, dirty: false, releaseReady: true,
  });
});
test("a stale or divergent candidate is rejected even for local dirty inspection", () => {
  assert.throws(() => checkReleaseBaseline({ liveBuildId: baseline, allowDirty: true, runGit: fakeGit({ ancestorStatus: 1 }) }), /does_not_include_live_release/);
});
test("dirty worktrees are blocked by default including untracked drafts", () => {
  assert.throws(() => checkReleaseBaseline({ liveBuildId: baseline, runGit: fakeGit({ dirty: true }) }), /not_clean/);
  const result = checkReleaseBaseline({ liveBuildId: baseline, allowDirty: true, runGit: fakeGit({ dirty: true }) });
  assert.equal(result.includesLiveRelease, true);
  assert.equal(result.releaseReady, false);
});
test("a different checked-out commit cannot attest to a candidate build", () => {
  assert.throws(() => checkReleaseBaseline({ liveBuildId: baseline, candidate: head, runGit: fakeGit({ checkedOut: baseline }) }), /not_checked_out/);
});
test("git failures and malformed ancestry results fail closed", () => {
  for (const runGit of [fakeGit({ error: true }), fakeGit({ ancestorStatus: 128 })]) {
    assert.throws(() => checkReleaseBaseline({ liveBuildId: baseline, runGit }), /git_check_failed/);
  }
});
test("only full commit IDs or explicit HEAD are accepted; flags cannot become git options", () => {
  for (const liveBuildId of [undefined, "", "abc123", "--help"]) {
    assert.throws(() => checkReleaseBaseline({ liveBuildId, runGit: fakeGit() }), /full_commit_sha/);
  }
  assert.throws(() => checkReleaseBaseline({ liveBuildId: baseline, candidate: "main", runGit: fakeGit() }), /candidate_must/);
  assert.deepEqual(parseBaselineArguments(["--live-build", baseline, "--candidate", head, "--allow-dirty"]), {
    liveBuildId: baseline, candidate: head, allowDirty: true,
  });
  for (const args of [["--anything"], ["--candidate"], ["--allow-dirty", "--allow-dirty"], ["--live-build", baseline, "--live-build", baseline]]) {
    assert.throws(() => parseBaselineArguments(args), /argument/);
  }
});
