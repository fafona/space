import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION,
  LEGACY_BROWSER_AUTH_SESSION_CUTOFF,
  LegacyBrowserAuthSessionRevocationError,
  parseLegacyBrowserAuthSessionArguments,
  revokeLegacyBrowserAuthSessions,
  runLegacyBrowserAuthSessionRevocationCli,
} from "./revoke-legacy-browser-auth-sessions.mjs";

const source = await readFile(
  new URL("./revoke-legacy-browser-auth-sessions.mjs", import.meta.url),
  "utf8",
);

function topology(name = "supabase-db") {
  return {
    available: true,
    databaseCandidates: [
      {
        name,
        probeSucceeded: true,
        tools: {
          psql: true,
          databaseConfigured: true,
        },
      },
    ],
  };
}

function lockProbe() {
  let released = false;
  return {
    lock: {
      async release() {
        released = true;
      },
    },
    wasReleased() {
      return released;
    },
  };
}

function result(stdout = "") {
  return {
    status: 0,
    stdout,
    stderr: "",
    timedOut: false,
    error: null,
  };
}

test("argument parser keeps apply behind the exact one-time confirmation", () => {
  assert.deepEqual(parseLegacyBrowserAuthSessionArguments(["--dry-run", "--json"]), {
    apply: false,
    dryRun: true,
    explicitDryRun: true,
    json: true,
    confirmation: "",
  });
  assert.deepEqual(
    parseLegacyBrowserAuthSessionArguments([
      "--apply",
      `--confirmation=${LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION}`,
      "--json",
    ]),
    {
      apply: true,
      dryRun: false,
      explicitDryRun: false,
      json: true,
      confirmation: LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION,
    },
  );
  assert.throws(
    () => parseLegacyBrowserAuthSessionArguments(["--apply"]),
    (error) =>
      error instanceof LegacyBrowserAuthSessionRevocationError &&
      error.code === "session_revocation_confirmation_invalid",
  );
  assert.throws(
    () =>
      parseLegacyBrowserAuthSessionArguments([
        "--apply",
        "--dry-run",
        `--confirmation=${LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION}`,
      ]),
    (error) =>
      error instanceof LegacyBrowserAuthSessionRevocationError &&
      error.code === "session_revocation_apply_and_dry_run_conflict",
  );
  assert.throws(
    () => parseLegacyBrowserAuthSessionArguments(["--cutoff=2099-01-01T00:00:00Z"]),
    (error) =>
      error instanceof LegacyBrowserAuthSessionRevocationError &&
      error.code === "session_revocation_argument_unknown",
  );
});

test("source fixes the cutoff and can only delete auth sessions and refresh tokens", () => {
  assert.match(source, new RegExp(LEGACY_BROWSER_AUTH_SESSION_CUTOFF.replaceAll(".", "\\.")));
  assert.match(source, /DELETE FROM auth\.refresh_tokens AS refresh_row/);
  assert.match(source, /DELETE FROM auth\.sessions AS session_row/);
  assert.doesNotMatch(source, /DELETE FROM auth\.(?:users|identities|mfa_factors)/);
  assert.doesNotMatch(source, /\bTRUNCATE\b/i);
  assert.match(source, /SELECT pg_advisory_xact_lock\(20260731, 1\)/);
  assert.match(source, /LOCK TABLE auth\.sessions IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(source, /LOCK TABLE auth\.refresh_tokens IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(source, /legacy_browser_auth_session_revocation_incomplete/);
  assert.match(source, /created_at IS NULL/);
});

test("dry run reports bounded candidates without applying deletes", async () => {
  const calls = [];
  const lock = lockProbe();
  const report = await revokeLegacyBrowserAuthSessions({
    dryRun: true,
    selfHostedTopology: topology(),
    acquireLock: async () => lock.lock,
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return result('{"sessionCount":4,"refreshTokenCount":7}\n');
    },
  });

  assert.equal(report.status, "dry_run");
  assert.equal(report.mode, "dry_run");
  assert.equal(report.cutoff, LEGACY_BROWSER_AUTH_SESSION_CUTOFF);
  assert.deepEqual(report.candidates, { sessionCount: 4, refreshTokenCount: 7 });
  assert.equal(report.executed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "docker");
  assert.deepEqual(calls[0].args.slice(0, 3), ["exec", "-i", "supabase-db"]);
  assert.doesNotMatch(calls[0].options.input, /DELETE FROM/);
  assert.equal(lock.wasReleased(), true);
});

test("apply revokes only bounded candidates and verifies the empty postcondition", async () => {
  const calls = [];
  const lock = lockProbe();
  const outputs = [
    '{"sessionCount":3,"refreshTokenCount":5}\n',
    "",
    '{"sessionCount":0,"refreshTokenCount":0}\n',
  ];
  const report = await revokeLegacyBrowserAuthSessions({
    apply: true,
    confirmation: LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION,
    selfHostedTopology: topology(),
    acquireLock: async () => lock.lock,
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return result(outputs.shift());
    },
  });

  assert.equal(report.status, "revoked");
  assert.equal(report.mode, "apply");
  assert.equal(report.executed, true);
  assert.deepEqual(report.candidates, { sessionCount: 3, refreshTokenCount: 5 });
  assert.deepEqual(report.remaining, { sessionCount: 0, refreshTokenCount: 0 });
  assert.equal(calls.length, 3);
  assert.match(calls[1].options.input, /^\s*BEGIN;/);
  assert.match(calls[1].options.input, /DELETE FROM auth\.refresh_tokens/);
  assert.match(calls[1].options.input, /DELETE FROM auth\.sessions/);
  assert.match(calls[1].options.input, /COMMIT;/);
  assert.equal(lock.wasReleased(), true);
});

test("apply is idempotent when the bounded cohort is already empty", async () => {
  let calls = 0;
  const report = await revokeLegacyBrowserAuthSessions({
    apply: true,
    confirmation: LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION,
    selfHostedTopology: topology(),
    acquireLock: async () => ({ release: async () => {} }),
    runCommand: async () => {
      calls += 1;
      return result('{"sessionCount":0,"refreshTokenCount":0}\n');
    },
  });
  assert.equal(report.status, "up_to_date");
  assert.equal(report.executed, false);
  assert.equal(calls, 1);
});

test("command failures are fail-closed and release the filesystem mutex", async () => {
  const lock = lockProbe();
  await assert.rejects(
    revokeLegacyBrowserAuthSessions({
      dryRun: true,
      selfHostedTopology: topology(),
      acquireLock: async () => lock.lock,
      runCommand: async () => ({
        status: 1,
        stdout: "",
        stderr: "permission denied",
        timedOut: false,
        error: null,
      }),
    }),
    (error) =>
      error instanceof LegacyBrowserAuthSessionRevocationError &&
      error.code === "session_revocation_candidate_query_failed",
  );
  assert.equal(lock.wasReleased(), true);
});

test("CLI emits structured reports and stable error codes without row data", async () => {
  const stdout = [];
  const stderr = [];
  const ok = await runLegacyBrowserAuthSessionRevocationCli({
    argv: ["--dry-run", "--json"],
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    execute: async () => ({
      schemaVersion: 1,
      mode: "dry_run",
      status: "dry_run",
      cutoff: LEGACY_BROWSER_AUTH_SESSION_CUTOFF,
      databaseContainer: "supabase-db",
      candidates: { sessionCount: 2, refreshTokenCount: 3 },
      remaining: { sessionCount: 2, refreshTokenCount: 3 },
      executed: false,
    }),
  });
  assert.equal(ok, 0);
  assert.equal(stderr.length, 0);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    schemaVersion: 1,
    mode: "dry_run",
    status: "dry_run",
    cutoff: LEGACY_BROWSER_AUTH_SESSION_CUTOFF,
    databaseContainer: "supabase-db",
    candidates: { sessionCount: 2, refreshTokenCount: 3 },
    remaining: { sessionCount: 2, refreshTokenCount: 3 },
    executed: false,
  });

  const failed = await runLegacyBrowserAuthSessionRevocationCli({
    argv: ["--apply", "--json"],
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  });
  assert.equal(failed, 1);
  assert.deepEqual(JSON.parse(stderr.at(-1)), {
    ok: false,
    error: "session_revocation_confirmation_invalid",
  });
});
