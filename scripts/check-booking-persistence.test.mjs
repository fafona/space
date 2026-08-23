import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  isTransientBookingPersistenceError,
  summarizeBookingPersistenceRows,
  waitForBookingPersistence,
} from "./check-booking-persistence.mjs";

const CHECKER_PATH = fileURLToPath(new URL("./check-booking-persistence.mjs", import.meta.url));

const VALID_ROWS = [
  {
    slug: "__merchant_booking_records__:v1",
    blocks: { version: 1, records: [{ id: "booking-1" }] },
    updated_at: "2026-07-23T10:00:00.000Z",
  },
  {
    slug: "__merchant_booking_workbench__:v1",
    blocks: { version: 1, settingsBySiteId: { "10000000": {} } },
    updated_at: "2026-07-23T10:00:00.000Z",
  },
  {
    slug: "__merchant_booking_rules__:v1",
    blocks: { version: 1, snapshots: {} },
    updated_at: "2026-07-23T10:00:00.000Z",
  },
];

async function startSupabaseFixture(handleRequest) {
  let requestCount = 0;
  const requests = [];
  const sockets = new Set();
  const server = createServer((request, response) => {
    requestCount += 1;
    requests.push({
      authorization: request.headers.authorization ?? "",
      apikey: request.headers.apikey ?? "",
      url: request.url ?? "",
    });
    handleRequest({ request, response, requestCount });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    get requestCount() {
      return requestCount;
    },
    requests,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function runChecker(url, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHECKER_PATH], {
      env: {
        ...process.env,
        SUPABASE_INTERNAL_URL: url,
        NEXT_PUBLIC_SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "local-primary-role",
        NEXT_SUPABASE_SERVICE_ROLE_KEY: "",
        BOOKING_PERSISTENCE_CHECK_ATTEMPTS: "2",
        BOOKING_PERSISTENCE_CHECK_DELAY_MS: "1",
        BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS: "200",
        ...environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("booking_persistence_checker_test_timeout"));
    }, 5_000);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stderr, stdout });
    });
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

test("booking persistence summary requires every valid internal store", () => {
  const summary = summarizeBookingPersistenceRows(VALID_ROWS);
  assert.equal(summary.complete, true);
  assert.deepEqual(
    summary.stores.map((store) => [store.slug, store.entryCount]),
    [
      ["__merchant_booking_records__:v1", 1],
      ["__merchant_booking_workbench__:v1", 1],
      ["__merchant_booking_rules__:v1", 0],
    ],
  );
});

test("booking persistence summary rejects missing or malformed rows", () => {
  const summary = summarizeBookingPersistenceRows([
    VALID_ROWS[0],
    {
      ...VALID_ROWS[1],
      blocks: { version: 1, settingsBySiteId: [] },
    },
  ]);
  assert.equal(summary.complete, false);
  assert.equal(
    summary.stores.find((store) => store.slug === "__merchant_booking_workbench__:v1")?.valid,
    false,
  );
  assert.equal(
    summary.stores.find((store) => store.slug === "__merchant_booking_rules__:v1")?.valid,
    false,
  );
});

test("booking persistence check treats incomplete data as a single hard failure", async () => {
  let requestCount = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: async () => {
          requestCount += 1;
          return { data: VALID_ROWS.slice(0, 2), error: null };
        },
      }),
    }),
  };

  await assert.rejects(
    () => waitForBookingPersistence(client, { attempts: 2, delayMs: 1 }),
    /booking_persistence_incomplete:__merchant_booking_rules__:v1/,
  );
  assert.equal(requestCount, 1);
});

test("booking persistence check surfaces hard database errors without retrying", async () => {
  let requestCount = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: async () => {
          requestCount += 1;
          return {
            data: null,
            error: { message: "permission denied for table pages" },
            status: 403,
          };
        },
      }),
    }),
  };

  await assert.rejects(
    () => waitForBookingPersistence(client, { attempts: 3, delayMs: 1 }),
    /booking_persistence_query_failed:permission denied for table pages/,
  );
  assert.equal(requestCount, 1);
});

test("booking persistence check retries transient database errors", async () => {
  let requestCount = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: async () => {
          requestCount += 1;
          if (requestCount === 1) {
            return {
              data: null,
              error: { message: "temporary upstream failure" },
              status: 503,
            };
          }
          return { data: VALID_ROWS, error: null };
        },
      }),
    }),
  };

  const result = await waitForBookingPersistence(client, {
    attempts: 2,
    delayMs: 1,
    queryTimeoutMs: 100,
  });
  assert.equal(result.complete, true);
  assert.equal(result.attemptsUsed, 2);
});

test("booking persistence check bounds a stalled query", async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => new Promise(() => {}),
      }),
    }),
  };

  await assert.rejects(
    () =>
      waitForBookingPersistence(client, {
        attempts: 1,
        queryTimeoutMs: 10,
      }),
    /booking_persistence_query_failed:query_timeout_10ms/,
  );
});

test("booking persistence transport classification keeps data failures strict", () => {
  assert.equal(
    isTransientBookingPersistenceError(
      new Error("booking_persistence_query_failed:query_timeout_10000ms"),
    ),
    true,
  );
  assert.equal(
    isTransientBookingPersistenceError(
      new Error("booking_persistence_query_failed:TypeError: fetch failed"),
    ),
    true,
  );
  assert.equal(
    isTransientBookingPersistenceError(
      new Error("booking_persistence_query_failed:permission denied for table pages"),
    ),
    false,
  );
  assert.equal(
    isTransientBookingPersistenceError(
      new Error("booking_persistence_incomplete:__merchant_booking_records__:v1"),
    ),
    false,
  );
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isTransientBookingPersistenceError({ status }), true);
  }
  for (const status of [400, 401, 403, 404]) {
    assert.equal(isTransientBookingPersistenceError({ status }), false);
  }
});

const HTTP_MATRIX = [
  {
    name: "200 valid rows",
    expectedExitCode: 0,
    expectedRequests: 1,
    respond: ({ response }) => sendJson(response, 200, VALID_ROWS),
  },
  {
    name: "text 503",
    expectedExitCode: 2,
    expectedRequests: 2,
    respond: ({ response }) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("temporarily unavailable");
    },
  },
  {
    name: "empty 502",
    expectedExitCode: 2,
    expectedRequests: 2,
    respond: ({ response }) => {
      response.writeHead(502);
      response.end();
    },
  },
  {
    name: "empty 503",
    expectedExitCode: 2,
    expectedRequests: 2,
    respond: ({ response }) => {
      response.writeHead(503);
      response.end();
    },
  },
  {
    name: "429",
    expectedExitCode: 2,
    expectedRequests: 2,
    respond: ({ response }) => sendJson(response, 429, { message: "rate limited" }),
  },
  {
    name: "403",
    expectedExitCode: 1,
    expectedRequests: 1,
    respond: ({ response }) => sendJson(response, 403, { message: "forbidden" }),
  },
  {
    name: "stalled response",
    expectedExitCode: 2,
    expectedRequests: 2,
    respond: () => {},
  },
];

for (const scenario of HTTP_MATRIX) {
  test(`booking persistence checker classifies real Supabase HTTP ${scenario.name}`, async (t) => {
    const fixture = await startSupabaseFixture(scenario.respond);
    t.after(() => fixture.close());
    const result = await runChecker(fixture.url);

    assert.equal(result.signal, null);
    assert.equal(result.code, scenario.expectedExitCode, result.stderr);
    assert.equal(fixture.requestCount, scenario.expectedRequests);
    assert.ok(fixture.requestCount <= 2);
  });
}

test("booking persistence checker trims primary environment values before using fallbacks", async (t) => {
  const fixture = await startSupabaseFixture(({ request, response }) => {
    if (
      request.headers.authorization !== "Bearer local-fallback-role" ||
      request.headers.apikey !== "local-fallback-role"
    ) {
      sendJson(response, 403, { message: "wrong role" });
      return;
    }
    sendJson(response, 200, VALID_ROWS);
  });
  t.after(() => fixture.close());

  const result = await runChecker(fixture.url, {
    SUPABASE_INTERNAL_URL: "   ",
    NEXT_PUBLIC_SUPABASE_URL: `  ${fixture.url}  `,
    SUPABASE_SERVICE_ROLE_KEY: "   ",
    NEXT_SUPABASE_SERVICE_ROLE_KEY: "  local-fallback-role  ",
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fixture.requestCount, 1);
  assert.equal(fixture.requests[0]?.authorization, "Bearer local-fallback-role");
  assert.equal(fixture.requests[0]?.apikey, "local-fallback-role");
});
