import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POST as POSTResetPassword,
  shouldReleaseRecoveryGrantAfterAuthError,
} from "@/app/api/auth/reset-password/route";
import { POST as POSTResetPasswordSession } from "@/app/api/auth/reset-password/session/route";
import { resolveRecoverySessionActivationEvidence } from "@/lib/passwordRecoveryGrant.server";
import { RESET_PASSWORD_RECOVERY_PROOF_COOKIE } from "@/lib/resetPasswordRecoverySession";

test("reset-password releases a claim only for definitive Auth 4xx errors", () => {
  assert.equal(
    shouldReleaseRecoveryGrantAfterAuthError({ status: 400, name: "AuthApiError" }),
    true,
  );
  assert.equal(
    shouldReleaseRecoveryGrantAfterAuthError({ status: 422, name: "AuthWeakPasswordError" }),
    true,
  );
  assert.equal(
    shouldReleaseRecoveryGrantAfterAuthError({ status: 429, name: "AuthApiError" }),
    true,
  );
  assert.equal(
    shouldReleaseRecoveryGrantAfterAuthError({ status: 0, name: "AuthRetryableFetchError", __isAuthError: true }),
    false,
  );
  assert.equal(
    shouldReleaseRecoveryGrantAfterAuthError({ status: 503, name: "AuthApiError" }),
    false,
  );
  assert.equal(shouldReleaseRecoveryGrantAfterAuthError(new Error("network")), false);
});

test("reset-password rejects short passwords before touching backend", async () => {
  const response = await POSTResetPassword(
    new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        password: "12345",
        tokenHash: "demo-token",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "reset_password_invalid_password",
  });
});

test("reset-password rejects missing recovery payload before touching backend", async () => {
  const response = await POSTResetPassword(
    new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        password: "secret123",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "reset_password_missing_recovery_payload",
  });
});

test("reset-password returns env-missing when Supabase config is absent", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousNextServiceRole = process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await POSTResetPassword(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          password: "secret123",
          tokenHash: "demo-token",
        }),
      }),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "reset_password_env_missing",
    });
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }
    if (previousAnon === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
    }
    if (previousServiceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
    }
    if (previousNextServiceRole === undefined) {
      delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY = previousNextServiceRole;
    }
  }
});

test("reset request endpoints never return the pending intent as a browser proof cookie", () => {
  for (const relativePath of [
    "src/app/api/auth/reset-password/request/route.ts",
    "src/app/api/auth/reset-password/request-code/route.ts",
  ]) {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    assert.doesNotMatch(source, /setResetRecoveryProofCookie/);
    assert.doesNotMatch(source, /prepared\.proofToken/);
  }
});

test("reset session accepts only a recovery token hash or a mail-return intent", () => {
  const intent = "A".repeat(43);

  assert.deepEqual(
    resolveRecoverySessionActivationEvidence({
      tokenHash: "recovery-token-hash",
      type: "recovery",
      recoveryIntent: "",
    }),
    {
      kind: "typed_recovery",
      tokenHash: "recovery-token-hash",
      proofToken: "",
    },
  );
  assert.deepEqual(
    resolveRecoverySessionActivationEvidence({
      tokenHash: "",
      type: "recovery",
      recoveryIntent: intent,
    }),
    {
      kind: "requested_intent",
      tokenHash: "",
      proofToken: intent,
    },
  );

  for (const type of ["password", "oauth", "invite", "magiclink", "email"]) {
    assert.equal(
      resolveRecoverySessionActivationEvidence({
        tokenHash: type === "invite" || type === "magiclink" ? `${type}-token-hash` : "",
        type,
        recoveryIntent: intent,
      }),
      null,
      `${type} must not be accepted as password-recovery evidence`,
    );
  }
});

test("reset session rejects ordinary sessions even with a stale pending-intent cookie", async () => {
  const staleProof = "s".repeat(43);

  for (const type of ["", "recovery", "password", "oauth", "invite", "magiclink"]) {
    const response = await POSTResetPasswordSession(
      new Request("http://localhost/api/auth/reset-password/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
          Cookie: `${RESET_PASSWORD_RECOVERY_PROOF_COOKIE}=${staleProof}`,
        },
        body: JSON.stringify({
          accessToken: "ordinary-access-token",
          refreshToken: "ordinary-refresh-token",
          type,
        }),
      }),
    );

    assert.equal(response.status, 401, `${type || "unlabelled"} session must be rejected`);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "reset_password_missing_recovery_proof",
    });
  }
});

test("final reset ignores browser-supplied ordinary session tokens", async () => {
  const response = await POSTResetPassword(
    new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        Cookie: `${RESET_PASSWORD_RECOVERY_PROOF_COOKIE}=${"s".repeat(43)}`,
      },
      body: JSON.stringify({
        password: "secret123",
        accessToken: "ordinary-access-token",
        refreshToken: "ordinary-refresh-token",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "reset_password_missing_recovery_payload",
  });
});
