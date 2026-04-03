import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "@/app/auth/confirm/route";
import { appendResetPasswordBridgeRedirectParams, isResetPasswordRedirectTarget } from "@/lib/authConfirmRedirect";

test("recovery confirm redirects to bridge without consuming token hash", async () => {
  const response = await GET(
    new Request(
      "http://localhost/auth/confirm?token_hash=demo-token&type=recovery&redirect_to=http%3A%2F%2Flocalhost%2Freset-password%2Fbridge",
    ),
  );

  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location);
  const url = new URL(location);
  assert.equal(url.pathname, "/reset-password/bridge");
  assert.equal(url.searchParams.get("type"), "recovery");
  assert.equal(url.searchParams.get("token_hash"), "demo-token");
});

test("recovery confirm forwards code links to bridge without requiring env", async () => {
  const response = await GET(
    new Request(
      "http://localhost/auth/confirm?code=demo-code&type=recovery&redirect_to=http%3A%2F%2Flocalhost%2Freset-password%2Fbridge",
    ),
  );

  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location);
  const url = new URL(location);
  assert.equal(url.pathname, "/reset-password/bridge");
  assert.equal(url.searchParams.get("type"), "recovery");
  assert.equal(url.searchParams.get("code"), "demo-code");
});

test("reset-password redirects are detected for reset page paths", () => {
  assert.equal(isResetPasswordRedirectTarget(new URL("http://localhost/reset-password")), true);
  assert.equal(isResetPasswordRedirectTarget(new URL("http://localhost/reset-password/bridge")), true);
  assert.equal(isResetPasswordRedirectTarget(new URL("http://localhost/login")), false);
});

test("reset-password bridge redirect preserves email flow payload", () => {
  const url = appendResetPasswordBridgeRedirectParams(new URL("http://localhost/reset-password"), {
    type: "email",
    tokenHash: "demo-token",
    code: "demo-code",
  });

  assert.equal(url.pathname, "/reset-password/bridge");
  assert.equal(url.searchParams.get("type"), "email");
  assert.equal(url.searchParams.get("token_hash"), "demo-token");
  assert.equal(url.searchParams.get("code"), "demo-code");
});
