import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function checkReleaseBaseline({
  liveBuildId,
  candidate = "HEAD",
  cwd = process.cwd(),
  allowDirty = false,
  runGit = (args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }),
}) {
  if (!COMMIT_SHA.test(liveBuildId || "")) throw new Error("live_build_must_be_full_commit_sha");
  if (candidate !== "HEAD" && !COMMIT_SHA.test(candidate)) throw new Error("candidate_must_be_HEAD_or_full_commit_sha");

  const git = (args) => {
    const result = runGit(args);
    if (result.error || result.signal || result.status !== 0) throw new Error("release_baseline_git_check_failed");
    return String(result.stdout || "").trim();
  };
  const baselineSha = git(["rev-parse", "--verify", `${liveBuildId}^{commit}`]);
  const candidateSha = git(["rev-parse", "--verify", `${candidate}^{commit}`]);
  if (!COMMIT_SHA.test(baselineSha) || !COMMIT_SHA.test(candidateSha)) throw new Error("invalid_resolved_commit");
  const ancestor = runGit(["merge-base", "--is-ancestor", baselineSha, candidateSha]);
  if (ancestor.error || ancestor.signal || ![0, 1].includes(ancestor.status)) {
    throw new Error("release_baseline_git_check_failed");
  }
  if (ancestor.status === 1) throw new Error("candidate_does_not_include_live_release");

  // A dirty worktree is useful for local verification, never release evidence.
  const headSha = git(["rev-parse", "--verify", "HEAD^{commit}"]);
  if (headSha !== candidateSha) throw new Error("candidate_is_not_checked_out");
  const dirty = Boolean(git(["status", "--porcelain", "--untracked-files=normal"]));
  if (dirty && !allowDirty) throw new Error("release_worktree_not_clean");
  return { baselineSha, candidateSha, includesLiveRelease: true, dirty, releaseReady: !dirty };
}

export function parseBaselineArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--allow-dirty") {
      if (options.allowDirty) throw new Error("duplicate_argument");
      options.allowDirty = true;
    } else if (flag === "--live-build" || flag === "--candidate") {
      const key = flag === "--live-build" ? "liveBuildId" : "candidate";
      if (options[key] !== undefined || args[index + 1] === undefined) throw new Error("invalid_argument");
      options[key] = args[++index];
    } else {
      throw new Error("unknown_argument");
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = checkReleaseBaseline(parseBaselineArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`[release-baseline] ${error instanceof Error ? error.message : "check_failed"}`);
    process.exitCode = 1;
  }
}
