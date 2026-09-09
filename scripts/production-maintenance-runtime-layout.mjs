import { posix } from "node:path";
import { isProxy } from "node:util/types";
import { TextDecoder } from "node:util";

// Metadata evidence only. It never relaxes the core target_path/file_links
// refusals, executes a binary, authorizes termination, or connects to PM2.
const ERROR = "production_maintenance_runtime_layout_invalid";
const LOCATIONS = ["usr_bin", "usr_local_bin", "opt", "other"];
const ASSESSMENTS = ["not_observed", "out_of_scope", "directory_rejected", "file_missing", "file_type", "file_owner",
  "file_links", "file_writable", "file_size", "file_not_executable", "metadata_verified", "unverified"];
const LINKS = ["two", "greaterThanTwo", "invalid", "unreadable"];
const OUTCOMES = ["unsupported_layout", "pair_missing", "untrusted_directory", "invalid_metadata", "not_double_linked",
  "different_inode", "package_mismatch", "argv_mismatch", "matched", "unverified"];
const SUFFIX = /^3(?:\.(?:0|[1-9]\d{0,3}))?$/;
const VERSION = /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/;
const IDENTITY = /^(?:0|[1-9]\d{0,24})(?::(?:0|[1-9]\d{0,24})){7}$/;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => { throw new Error(ERROR); };
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 16384;
function exact(value, keys) {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every((key) =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"));
}
const absolute = (value) => typeof value === "string" && value.length <= 4096 && value.startsWith("/") &&
  !/[\0\r\n]/.test(value) && posix.normalize(value) === value && value.split("/").length <= 64;
export const emptyPythonLayout = () => ({ location: null, pathSuffix: null, assessment: "not_observed" });
export const emptyNativeFileLinkEvidence = () => ({ linkCounts: Object.fromEntries(LINKS.map((key) => [key, 0])),
  outcomes: Object.fromEntries(OUTCOMES.map((key) => [key, 0])) });
export function validatePythonLayout(value) {
  if (!exact(value, ["location", "pathSuffix", "assessment"]) || !(value.location === null || LOCATIONS.includes(value.location)) ||
      !(value.pathSuffix === null || (typeof value.pathSuffix === "string" && SUFFIX.test(value.pathSuffix))) || !ASSESSMENTS.includes(value.assessment)) fail();
  if (value.assessment === "not_observed" ? !equal(value, emptyPythonLayout()) : value.location === null) fail();
  if (!["not_observed", "out_of_scope"].includes(value.assessment) &&
      (!["usr_bin", "usr_local_bin"].includes(value.location) || value.pathSuffix === null)) fail();
  return structuredClone(value);
}
export function validateNativeFileLinkEvidence(value, expectedCount) {
  if (!count(expectedCount) || !exact(value, ["linkCounts", "outcomes"]) || !exact(value.linkCounts, LINKS) || !exact(value.outcomes, OUTCOMES) ||
      !LINKS.every((key) => count(value.linkCounts[key])) || !OUTCOMES.every((key) => count(value.outcomes[key])) ||
      Object.values(value.linkCounts).reduce((sum, n) => sum + n, 0) !== expectedCount ||
      Object.values(value.outcomes).reduce((sum, n) => sum + n, 0) !== expectedCount || value.outcomes.matched > value.linkCounts.two) fail();
  return structuredClone(value);
}
function observedPath(path, d, witness) {
  const info = d.pathInfo(path); witness.push({ path, info: structuredClone(info) }); return info;
}
function chain(path, owner, d, witness) {
  if (!absolute(path)) return "unsafe";
  const paths = ["/"]; let current = "";
  for (const segment of path.split("/").filter(Boolean)) { current += "/" + segment; paths.push(current); }
  for (const item of paths) {
    const info = observedPath(item, d, witness);
    if (!info) return "missing";
    if (info.type !== "directory" || ![0, owner].includes(info.uid) || (info.mode & 0o022) !== 0 || d.canonical(item) !== item) return "unsafe";
  }
  return "verified";
}
function revalidate(witness, d) {
  for (const { path, info } of witness) if (!equal(d.pathInfo(path), info)) d.drift();
}
function fileRejection(info, owner, limit, links) {
  if (!info) return "file_missing";
  if (info.type !== "file") return "file_type";
  if (![0, owner].includes(info.uid)) return "file_owner";
  if (info.nlink !== links) return "file_links";
  if ((info.mode & 0o022) !== 0) return "file_writable";
  if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > limit) return "file_size";
  return null;
}
export function observePythonLayout(executable, d) {
  const result = emptyPythonLayout(); const witness = [];
  if (typeof executable !== "string") return { result, witness };
  const valid = absolute(executable); const dirname = valid ? posix.dirname(executable) : "";
  result.location = dirname === "/usr/bin" ? "usr_bin" : dirname === "/usr/local/bin" ? "usr_local_bin" :
    valid && executable.startsWith("/opt/") ? "opt" : "other";
  const suffix = valid ? posix.basename(executable).match(/^python(3(?:\.(?:0|[1-9]\d{0,3}))?)$/)?.[1] : null;
  result.pathSuffix = suffix ?? null; result.assessment = "out_of_scope";
  if (!["usr_bin", "usr_local_bin"].includes(result.location) || !suffix) return { result, witness };
  try {
    if (chain(dirname, 0, d, witness) !== "verified") result.assessment = "directory_rejected";
    else {
      const info = observedPath(executable, d, witness);
      result.assessment = fileRejection(info, 0, 64 * 1024 * 1024, 1) ||
        ((info.mode & 0o111) === 0 ? "file_not_executable" : "metadata_verified");
      if (result.assessment === "metadata_verified" && d.canonical(executable) !== executable) result.assessment = "file_type";
    }
    revalidate(witness, d);
  } catch (error) { d.rethrowDrift(error); result.assessment = "unverified"; }
  return { result, witness };
}
export function observeNativeFileLink({ fact, runtime, owner, architecture, binary }, d) {
  const witness = [];
  const linkCount = !binary ? "unreadable" : !Number.isSafeInteger(binary.nlink) || binary.nlink < 2 ? "invalid" :
    binary.nlink === 2 ? "two" : "greaterThanTwo";
  const result = (outcome) => ({ linkCount, outcome, witness });
  if (!absolute(runtime) || !["x64", "arm64"].includes(architecture) || !absolute(fact?.executable)) return result("unsupported_layout");
  const platformName = `@esbuild/linux-${architecture}`;
  const modules = [runtime + "/node_modules", runtime + "/node_modules/tsx/node_modules"];
  const roots = modules.map((base) => ({ platform: base + "/" + platformName, wrapper: base + "/esbuild" }));
  const pairs = [[roots[0].platform, roots[0].wrapper], [roots[1].platform, roots[1].wrapper], [roots[0].platform, roots[1].wrapper]]
    .filter(([platform, wrapper]) => [platform + "/bin/esbuild", wrapper + "/bin/esbuild"].includes(fact.executable));
  if (!pairs.length) return result("unsupported_layout");
  if (fact.uid !== owner || fact.cwd !== runtime) return result("invalid_metadata");
  if (linkCount !== "two") return result(linkCount === "greaterThanTwo" ? "not_double_linked" : linkCount === "invalid" ? "invalid_metadata" : "unverified");
  const frozenFact = structuredClone(fact); const frozenBinary = structuredClone(binary);
  const finish = (outcome) => {
    revalidate(witness, d); if (!equal(d.readProcess(frozenFact.pid), frozenFact)) d.drift(); return result(outcome);
  };
  try {
    if (!equal(d.readProcess(frozenFact.pid), frozenFact)) d.drift();
    if (frozenFact.executableIdentity !== frozenBinary.identity) d.drift();
    const matches = []; let missing = false; let different = false; let notDouble = false;
    for (const [platform, wrapper] of pairs) {
      let absent = false; const files = [];
      for (const path of [platform + "/bin/esbuild", wrapper + "/bin/esbuild"]) {
        const directory = chain(posix.dirname(path), owner, d, witness);
        if (directory === "missing") { absent = true; break; }
        if (directory !== "verified") return finish("untrusted_directory");
        const info = observedPath(path, d, witness);
        if (!info) { absent = true; break; }
        if (path === frozenFact.executable && !equal(info, frozenBinary)) d.drift();
        const rejection = fileRejection(info, owner, 64 * 1024 * 1024, 2);
        if (rejection === "file_links") { notDouble = true; absent = true; break; }
        if (rejection || (info.mode & 0o111) === 0 || d.canonical(path) !== path || typeof info.identity !== "string" || !IDENTITY.test(info.identity)) return finish("invalid_metadata");
        files.push(info);
      }
      if (absent) { missing = true; continue; }
      if (files[0].identity.split(":").slice(0, 2).join(":") !== files[1].identity.split(":").slice(0, 2).join(":")) { different = true; continue; }
      matches.push([platform, wrapper]);
    }
    if (matches.length > 1) return finish("invalid_metadata");
    if (!matches.length) return finish(notDouble ? "not_double_linked" : different ? "different_inode" : missing ? "pair_missing" : "unverified");
    const packages = [];
    for (const root of matches[0]) {
      const path = root + "/package.json"; const info = observedPath(path, d, witness);
      if (fileRejection(info, owner, 8192, 1)) return finish("package_mismatch");
      const bytes = d.readRegular(path, 8192, info).bytes;
      try { packages.push(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
      catch { return finish("package_mismatch"); }
    }
    const [platform, wrapper] = packages;
    if (platform?.name !== platformName || wrapper?.name !== "esbuild" || typeof platform.version !== "string" || !VERSION.test(platform.version) ||
        wrapper.version !== platform.version || wrapper.optionalDependencies?.[platformName] !== platform.version) return finish("package_mismatch");
    if (!equal(frozenFact.commandLine, [frozenFact.executable, `--service=${platform.version}`, "--ping"])) return finish("argv_mismatch");
    return finish("matched");
  } catch (error) { d.rethrowDrift(error); return result("unverified"); }
}
