import assert from "node:assert/strict";
import test from "node:test";

import {
  MERCHANT_BUSINESS_API_DEFAULT_TIMEOUT_MS,
  MERCHANT_BUSINESS_API_MAX_TIMEOUT_MS,
  MERCHANT_BUSINESS_API_MIN_TIMEOUT_MS,
  MerchantBusinessApiPathError,
  MerchantBusinessApiCredentialError,
  MerchantBusinessApiTimeoutError,
  createMerchantBusinessApiClient,
  normalizeMerchantBusinessApiPath,
  normalizeMerchantBusinessApiTimeoutMs,
  resolveMerchantBusinessCachePolicy,
  type MerchantBusinessApiFetch,
} from "@/lib/merchantBusinessApiClient";

type CapturedRequest = {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
};

function capturingFetch(response: Response) {
  const requests: CapturedRequest[] = [];
  const fetchImpl: MerchantBusinessApiFetch = async (input, init) => {
    requests.push({ input, init });
    return response;
  };
  return { fetchImpl, requests };
}

test("employee requests use only the explicit access token and omit browser credentials", async () => {
  const expectedResponse = new Response("employee-ok", { status: 202 });
  const { fetchImpl, requests } = capturingFetch(expectedResponse);
  const client = createMerchantBusinessApiClient({
    authMode: "employee",
    accessToken: "  employee-access-token  ",
    defaultHeaders: {
      accept: "application/json",
      authorization: "Bearer default-secret",
      "x-merchant-site-id": "10000000",
      "x-merchant-refresh-token": "default-refresh-token",
      "x-default-header": "default-value",
    },
    fetchImpl,
  });

  const response = await client("/api/orders?siteId=10000000", {
    method: "PATCH",
    cache: "force-cache",
    credentials: "include",
    headers: new Headers({
      accept: "application/problem+json",
      "content-type": "application/json",
      cookie: "merchant=fallback",
      "x-merchant-access-token": "caller-token",
      "x-merchant-email": "owner@example.test",
      "x-merchant-refresh-token": "caller-refresh-token",
      "x-request-header": "request-value",
    }),
    body: JSON.stringify({ siteId: "10000000" }),
  });

  assert.equal(response, expectedResponse);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/orders?siteId=10000000");
  assert.equal(requests[0]?.init?.method, "PATCH");
  assert.equal(requests[0]?.init?.credentials, "omit");
  assert.equal(requests[0]?.init?.cache, "no-store");
  assert.equal(requests[0]?.init?.mode, "same-origin");
  assert.equal(requests[0]?.init?.redirect, "error");

  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("x-merchant-access-token"), "employee-access-token");
  assert.equal(headers.get("x-merchant-refresh-token"), null);
  assert.equal(headers.get("x-merchant-site-id"), null);
  assert.equal(headers.get("x-merchant-email"), null);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("accept"), "application/problem+json");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-default-header"), "default-value");
  assert.equal(headers.get("x-request-header"), "request-value");
});

test("owner requests rely on included cookies and never forward token headers", async () => {
  const { fetchImpl, requests } = capturingFetch(new Response("owner-ok"));
  const client = createMerchantBusinessApiClient({
    authMode: "owner",
    defaultHeaders: { accept: "application/json" },
    fetchImpl,
  });

  await client("/api/bookings", {
    headers: {
      "x-merchant-access-token": "caller-access-token",
      "x-merchant-refresh-token": "caller-refresh-token",
      "x-correlation-id": "request-1",
    },
  });

  assert.equal(requests[0]?.init?.credentials, "include");
  assert.equal(requests[0]?.init?.cache, "no-store");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("x-merchant-access-token"), null);
  assert.equal(headers.get("x-merchant-refresh-token"), null);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("x-correlation-id"), "request-1");
});

test("only normalized relative /api paths are accepted", () => {
  assert.equal(normalizeMerchantBusinessApiPath("/api"), "/api");
  assert.equal(
    normalizeMerchantBusinessApiPath("/api/orders?siteId=10000000"),
    "/api/orders?siteId=10000000",
  );

  for (const path of [
    "https://evil.example/api/orders",
    "//evil.example/api/orders",
    "api/orders",
    "/admin",
    "/api/../admin",
    "/api/%2e%2e/admin",
    "/api\\orders",
    "/api/orders#secret",
    " /api/orders",
    "/api/orders\n",
  ]) {
    assert.throws(
      () => normalizeMerchantBusinessApiPath(path),
      (error) =>
        error instanceof MerchantBusinessApiPathError &&
        error.code === "merchant_business_api_path_invalid",
      path,
    );
  }
});

test("caller abort signals are forwarded without being converted to timeouts", async () => {
  const callerController = new AbortController();
  const abortReason = new Error("caller_cancelled");
  let requestSignal: AbortSignal | null = null;
  const fetchImpl: MerchantBusinessApiFetch = async (_input, init) => {
    requestSignal = init?.signal ?? null;
    return await new Promise<Response>(() => undefined);
  };
  const client = createMerchantBusinessApiClient({
    authMode: "owner",
    fetchImpl,
    timeoutMs: 10_000,
  });

  const pending = client("/api/orders", { signal: callerController.signal });
  callerController.abort(abortReason);

  await assert.rejects(pending, (error) => error === abortReason);
  assert.equal((requestSignal as AbortSignal | null)?.aborted, true);
});

test("requests time out with a bounded timeout and abort the injected fetch", async () => {
  let requestSignal: AbortSignal | null = null;
  const fetchImpl: MerchantBusinessApiFetch = async (_input, init) => {
    requestSignal = init?.signal ?? null;
    return await new Promise<Response>(() => undefined);
  };
  const client = createMerchantBusinessApiClient({
    authMode: "owner",
    fetchImpl,
    timeoutMs: 1,
  });

  await assert.rejects(
    client("/api/bookings"),
    (error) =>
      error instanceof MerchantBusinessApiTimeoutError &&
      error.code === "merchant_business_api_timeout" &&
      error.timeoutMs === MERCHANT_BUSINESS_API_MIN_TIMEOUT_MS,
  );
  assert.equal((requestSignal as AbortSignal | null)?.aborted, true);
});

test("timeout normalization enforces finite lower and upper bounds", () => {
  assert.equal(
    normalizeMerchantBusinessApiTimeoutMs(undefined),
    MERCHANT_BUSINESS_API_DEFAULT_TIMEOUT_MS,
  );
  assert.equal(
    normalizeMerchantBusinessApiTimeoutMs(Number.NaN),
    MERCHANT_BUSINESS_API_DEFAULT_TIMEOUT_MS,
  );
  assert.equal(
    normalizeMerchantBusinessApiTimeoutMs(-1),
    MERCHANT_BUSINESS_API_MIN_TIMEOUT_MS,
  );
  assert.equal(
    normalizeMerchantBusinessApiTimeoutMs(Number.MAX_SAFE_INTEGER),
    MERCHANT_BUSINESS_API_MAX_TIMEOUT_MS,
  );
});

test("all business cache policies disable persistent and stale data", () => {
  const employee = resolveMerchantBusinessCachePolicy("employee");
  assert.deepEqual(employee, {
    mode: "disabled",
    allowPersistentRead: false,
    allowPersistentWrite: false,
    allowStaleOnError: false,
  });
  assert.equal(Object.isFrozen(employee), true);

  const owner = resolveMerchantBusinessCachePolicy("owner");
  assert.deepEqual(owner, {
    mode: "disabled",
    allowPersistentRead: false,
    allowPersistentWrite: false,
    allowStaleOnError: false,
  });
  assert.equal(Object.isFrozen(owner), true);
});

test("auth mode never falls back between employee headers and owner cookies", () => {
  assert.throws(
    () => createMerchantBusinessApiClient({ authMode: "employee" }),
    MerchantBusinessApiCredentialError,
  );
  assert.throws(
    () =>
      createMerchantBusinessApiClient({
        authMode: "employee",
        accessToken: "   ",
      }),
    MerchantBusinessApiCredentialError,
  );
  assert.throws(
    () =>
      createMerchantBusinessApiClient({
        authMode: "owner",
        accessToken: "employee-token",
      }),
    MerchantBusinessApiCredentialError,
  );
});
