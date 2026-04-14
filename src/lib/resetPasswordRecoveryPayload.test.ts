import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResetPasswordRecoveryUrl,
  stripDirectResetPasswordRecoveryPayloadTokens,
  type ResetPasswordRecoveryPayload,
} from "@/lib/resetPasswordRecoveryPayload";

test("buildResetPasswordRecoveryUrl strips direct session tokens from the browser url", () => {
  const payload: ResetPasswordRecoveryPayload = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenHash: "",
    code: "",
    type: "recovery",
    capturedAt: Date.now(),
  };
  const url = buildResetPasswordRecoveryUrl("https://faolla.com/reset-password", payload);
  assert.equal(url.pathname, "/reset-password");
  assert.equal(url.hash, "#type=recovery");
});

test("buildResetPasswordRecoveryUrl keeps target unchanged when payload is empty", () => {
  const url = buildResetPasswordRecoveryUrl("https://faolla.com/reset-password", null);
  assert.equal(url.toString(), "https://faolla.com/reset-password");
});

test("stripDirectResetPasswordRecoveryPayloadTokens keeps code and token hash but drops direct session tokens", () => {
  const payload = stripDirectResetPasswordRecoveryPayloadTokens({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenHash: "token-hash",
    code: "exchange-code",
    type: "recovery",
    capturedAt: Date.now(),
  });

  assert.deepEqual(payload && {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    tokenHash: payload.tokenHash,
    code: payload.code,
    type: payload.type,
  }, {
    accessToken: "",
    refreshToken: "",
    tokenHash: "token-hash",
    code: "exchange-code",
    type: "recovery",
  });
});
