import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "@/app/auth/confirm/route";

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
