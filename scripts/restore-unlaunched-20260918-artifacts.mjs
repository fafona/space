import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { validateLaunchDisk } from "./production-maintenance-runtime.mjs";
import { readFrozenProductionSupabaseRollbackEnvironmentSnapshot } from "./read-production-supabase-environment.mjs";

const fail = () => { throw new Error("restoration_candidate_artifacts"); };
const identity = s => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"].map(k => String(s[k])).join(":");
const hash = b => createHash("sha256").update(b).digest("hex");
export function validateTrackedBlob(mode, expected, bytes) {
  if (!/^(100644|100755)$/.test(mode) || !/^[a-f0-9]{40}$/.test(expected) || !Buffer.isBuffer(bytes) ||
    createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== expected) fail();
}
export async function inspectUnlaunchedArtifacts(p, proof) {
  if (p.release !== "/www/wwwroot/merchant-space.releases/1aab7b9beb10-20260917225453" || realpathSync(p.release) !== p.release) fail();
  const stat = path => lstatSync(path, { bigint: true });
  const root = stat(p.release);
  if (!root.isDirectory() || root.uid !== 0n || (root.mode & 0o022n)) fail();
  const file = (path, allowInternalHardlinks = false) => {
    const before = stat(path);
    if (!before.isFile() || before.uid !== 0n || (!allowInternalHardlinks && before.nlink !== 1n) || (before.mode & 0o022n) || before.size > 536870912n || realpathSync(path) !== path) fail();
    const bytes = readFileSync(path);
    if (identity(stat(path)) !== identity(before)) fail();
    return { bytes, identity: identity(before), digest: hash(bytes) };
  };
  const env = file(p.release + "/.env.local"), build = file(p.release + "/.next/BUILD_ID");
  if (build.bytes.toString().trim() !== "UONVhXd9nyN8w5DIjhfAI") fail();
  const frozenEnv = readFrozenProductionSupabaseRollbackEnvironmentSnapshot(p.release + "/.env.local", p.targetSha);
  if (frozenEnv.sha256 !== env.digest) fail();
  const nextEntryPath = p.release + "/node_modules/next/dist/bin/next", entry = file(nextEntryPath);
  const disk = validateLaunchDisk({ runtime: p.release, runtimeIdentity: identity(root), environmentIdentity: env.identity,
    environmentDigest: env.digest, nextBuildIdentity: build.identity, nextBuildDigest: build.digest, nextEntryPath, nextEntryIdentity: entry.identity }, proof, p.targetSha);
  const git = spawnSync("/usr/bin/git", ["-C", p.appDir, "ls-tree", "-r", "-z", p.targetSha], { encoding: "utf8", timeout: 20000, maxBuffer: 8388608 });
  if (git.status !== 0 || git.error || git.signal) fail();
  for (const row of git.stdout.split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0\r\n]+)$/.exec(row);
    if (!match || resolve(p.release, match[3]) !== p.release + "/" + match[3]) fail();
    validateTrackedBlob(match[1], match[2], file(p.release + "/" + match[3]).bytes);
  }
  const manifest = createHash("sha256"), links = new Map(); let count = 0, total = 0;
  const visit = (path, relative = "") => {
    if (++count > 200000) fail();
    const before = stat(path);
    if (before.uid !== 0n || (!before.isSymbolicLink() && (before.mode & 0o022n))) fail();
    let content;
    if (before.isSymbolicLink()) {
      content = readlinkSync(path);
      const actual = realpathSync(path);
      if (relative === ".runtime" ? actual !== p.appDir + ".shared/.runtime" : !actual.startsWith(p.release + "/")) fail();
    } else if (before.isDirectory()) {
      content = "directory";
      for (const name of readdirSync(path).sort()) visit(path + "/" + name, relative ? relative + "/" + name : name);
    } else {
      total += Number(before.size); if (total > 4294967296) fail();
      content = file(path, true).digest;
      const key = before.dev + ":" + before.ino, link = links.get(key) ?? { count: 0, expected: Number(before.nlink) };
      if (link.expected !== Number(before.nlink)) fail();
      link.count++; links.set(key, link);
    }
    if (identity(stat(path)) !== identity(before)) fail();
    manifest.update(JSON.stringify([relative, identity(before), content]) + "\n");
  };
  visit(p.release);
  if ([...links.values()].some(link => link.count !== link.expected)) fail();
  if (identity(stat(p.release)) !== disk.runtimeIdentity) fail();
  return { disk, digest: manifest.digest("hex") };
}
