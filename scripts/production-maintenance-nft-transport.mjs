import { spawnSync } from "node:child_process";
import { types } from "node:util";
import { captureTrustedPython, verifyTrustedPython } from "./production-maintenance-trusted-python.mjs";

// Transport only: the ingress owner must validate and durably bind its exact
// rule plan before calling this. No CLI, retries, files, shell or rollback.
// Node/libuv stdin pipes are Unix sockets; nft 1.0.9 rejects their file type.
// Python's subprocess input uses an actual OS pipe accepted by nft -f -.
// Reviewed official nftables 1.0.9 libnftables.c filename_is_useable accepts
// S_IFREG/S_IFIFO; 0.9.3 scanner.l scanner_include_file opens /dev/stdin.
// https://www.netfilter.org/projects/nftables/files/
const MAX = 2_097_152;
const ERROR = "production_maintenance_nft_transport_unverified";
const fail = () => { throw new Error(ERROR); };
export const NFT_PIPE_PYTHON = String.raw`
import subprocess, sys
MAX = 2097152
try:
    payload = sys.stdin.buffer.read(MAX + 1)
    if not payload or len(payload) > MAX or b"\x00" in payload:
        raise ValueError("invalid_payload")
    payload.decode("utf-8", "strict")
    result = subprocess.run(["/usr/sbin/nft", "-f", "-"], input=payload,
        stdout=sys.stdout.buffer, stderr=sys.stderr.buffer, shell=False,
        close_fds=True, timeout=10,
        env={"PATH":"/usr/sbin:/usr/bin:/sbin:/bin", "LANG":"C", "LC_ALL":"C"})
    sys.exit(result.returncode if 0 <= result.returncode <= 255 else 1)
except Exception:
    sys.exit(1)
`;

function dependencies(overrides) {
  if (overrides === undefined) return { spawn: spawnSync, capturePython: captureTrustedPython, verifyPython: verifyTrustedPython };
  if (!overrides || typeof overrides !== "object" || types.isProxy(overrides) || Array.isArray(overrides) ||
      Object.getPrototypeOf(overrides) !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(overrides);
  if (Reflect.ownKeys(descriptors).some((key) => !["spawn", "capturePython", "verifyPython"].includes(key) ||
      !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value") ||
      typeof descriptors[key].value !== "function" || types.isProxy(descriptors[key].value))) fail();
  return { spawn: descriptors.spawn?.value ?? spawnSync, capturePython: descriptors.capturePython?.value ?? captureTrustedPython,
    verifyPython: descriptors.verifyPython?.value ?? verifyTrustedPython };
}

export function runNftBatch(script, overrides) {
  try {
    if (typeof script !== "string" || !script.length || script.includes("\0") || Buffer.byteLength(script) > MAX) fail();
    const d = dependencies(overrides), python = d.capturePython();
    if (d.verifyPython(python) !== true) fail();
    const result = d.spawn(python.target.path, ["-I", "-S", "-B", "-c", NFT_PIPE_PYTHON], {
      input: script, encoding: "utf8", shell: false, windowsHide: true,
      timeout: 15_000, killSignal: "SIGKILL", maxBuffer: MAX,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" },
    });
    if (d.verifyPython(python) !== true || result.error || result.signal || result.status !== 0 ||
        typeof result.stdout !== "string" || typeof result.stderr !== "string" ||
        Buffer.byteLength(result.stdout) > MAX || Buffer.byteLength(result.stderr) > MAX ||
        result.stdout.includes("\0") || result.stderr.includes("\0")) fail();
    return { stdout: result.stdout, stderr: result.stderr };
  } catch { fail(); }
}
