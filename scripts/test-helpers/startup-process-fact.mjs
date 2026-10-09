// CI fixture projection only. Production process capture remains authoritative.
import { readFileSync } from "node:fs";

export const STARTUP_PROCESS_FACT_KEYS = Object.freeze([
  "pid", "parentPid", "startTicks", "processIdentity", "uid", "cwd",
  "cwdIdentity", "executable", "executableIdentity", "commandLineDigest",
]);

export function captureStartupFixtureProcessFact(pid, captureProcessFact) {
  // A logical fact must never combine fields from different process captures.
  // Let every capture failure propagate; no retry or cached fallback is safe here.
  const snapshot = captureProcessFact(pid);
  return Object.fromEntries(
    STARTUP_PROCESS_FACT_KEYS.map((key) => [key, snapshot[key]]),
  );
}

// PM2's online acknowledgement precedes Next's process.title initialization.
// This marker only schedules the first capture; it is not an identity/health fact.
export async function waitForStartupFixtureTitle({
  pid, version, deadline,
  readCommandLine = (value) => readFileSync(`/proc/${value}/cmdline`),
  now = Date.now,
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 ||
      typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.+-]+)?$/.test(version) || version.length > 64 ||
      !Number.isSafeInteger(deadline) || deadline <= 0) {
    throw new Error("startup_fixture_title_input_invalid");
  }
  const expected = Buffer.from(`next-server (v${version})\0`, "utf8");
  while (now() < deadline) {
    const bytes = readCommandLine(pid);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 64 * 1024 || bytes.at(-1) !== 0) {
      throw new Error("startup_fixture_title_bytes_invalid");
    }
    // Invalid UTF-8 is never treated as pending; never log the raw command line.
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (now() >= deadline) break;
    if (bytes.length >= expected.length && bytes.subarray(0, expected.length).equals(expected) &&
        bytes.subarray(expected.length).every((byte) => byte === 0)) return;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await pause(Math.min(25, remaining));
  }
  throw new Error("startup_fixture_title_timeout");
}
