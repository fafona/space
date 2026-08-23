import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverRequiredMigrationVersions,
  runProductionOperationsCheck,
} from "./check-production-operations.mjs";

const VALID_BOOKING_ROWS = [
  {
    slug: "__merchant_booking_records__:v1",
    blocks: { version: 1, records: [] },
    updated_at: "2026-07-27T00:00:00.000Z",
  },
  {
    slug: "__merchant_booking_workbench__:v1",
    blocks: { version: 1, settingsBySiteId: {} },
    updated_at: "2026-07-27T00:00:00.000Z",
  },
  {
    slug: "__merchant_booking_rules__:v1",
    blocks: { version: 1, snapshots: {} },
    updated_at: "2026-07-27T00:00:00.000Z",
  },
];

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function createFetchRouter(options = {}) {
  const requests = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/auth/v1/settings")) {
      return options.authResponse ?? jsonResponse({ external: {} });
    }
    if (url.includes("merchant_id=eq.__faolla_booking_persistence__")) {
      return jsonResponse(options.bookingRows ?? VALID_BOOKING_ROWS);
    }
    if (url.includes("/rest/v1/pages?select=id")) {
      return jsonResponse([{ id: "row-1" }], {
        headers: { "content-range": "0-0/18" },
      });
    }
    if (url.includes("/rest/v1/faolla_schema_migrations")) {
      if (options.migrationRows) return jsonResponse(options.migrationRows);
      return jsonResponse(
        {
          code: "PGRST205",
          message: "Could not find the table in the schema cache",
        },
        { status: 404 },
      );
    }
    if (url.includes("/rest/v1/rpc/faolla_get_merchant_outbox_health_v1")) {
      return jsonResponse(
        options.outboxHealth ?? {
          pending_count: 0,
          retry_scheduled_count: 0,
          processing_count: 0,
          dead_letter_count: 0,
          expired_lease_count: 0,
          attempt_limit_risk_count: 0,
          unknown_event_type_count: 0,
          oldest_due_age_seconds: 0,
          retry_attempts_in_window: 0,
          lease_expired_attempts_in_window: 0,
        },
      );
    }
    throw new Error(`unexpected_url:${url}`);
  };
  return { fetchImpl, requests };
}

function healthySmoke() {
  return {
    buildId: "test-build",
    pagesChecked: 4,
    assetsChecked: 12,
  };
}

function monitorOptions(fetchImpl, overrides = {}) {
  return {
    origin: "https://faolla.example",
    supabaseUrl: "https://project.supabase.co",
    anonKey: "anon-test-key",
    serviceRoleKey: "service-test-key",
    fetchImpl,
    runSmoke: healthySmoke,
    requestAttempts: 1,
    timeoutMs: 1_000,
    ...overrides,
  };
}

test("production operations monitor keeps an absent V1 registry non-blocking", async () => {
  const router = createFetchRouter();
  const report = await runProductionOperationsCheck(
    monitorOptions(router.fetchImpl),
  );

  assert.equal(report.status, "degraded");
  assert.equal(
    report.checks.find((check) => check.name === "public_site")?.status,
    "healthy",
  );
  assert.equal(
    report.checks.find((check) => check.name === "legacy_pages")?.rowCount,
    18,
  );
  assert.equal(
    report.checks.find((check) => check.name === "booking_persistence")?.status,
    "healthy",
  );
  assert.equal(
    report.checks.find((check) => check.name === "v1_migrations")?.status,
    "not_ready",
  );
  assert.equal(
    report.checks.find((check) => check.name === "outbox_v1")?.status,
    "not_ready",
  );
});

test("production operations monitor fails when a required legacy store is malformed", async () => {
  const router = createFetchRouter({
    bookingRows: VALID_BOOKING_ROWS.slice(0, 2),
  });
  const report = await runProductionOperationsCheck(
    monitorOptions(router.fetchImpl),
  );

  assert.equal(report.status, "critical");
  assert.equal(
    report.checks.find((check) => check.name === "booking_persistence")?.error,
    "required_store_missing",
  );
});

test("production operations monitor rejects present booking stores with malformed blocks without reporting their contents", async () => {
  const privateBlockMarker = "private-booking-block-content";
  const router = createFetchRouter({
    bookingRows: VALID_BOOKING_ROWS.map((row) => ({
      ...row,
      blocks: { version: 1, malformed: privateBlockMarker },
    })),
  });
  const report = await runProductionOperationsCheck(
    monitorOptions(router.fetchImpl),
  );
  const bookingCheck = report.checks.find(
    (check) => check.name === "booking_persistence",
  );
  const bookingRequest = router.requests.find((url) =>
    url.includes("merchant_id=eq.__faolla_booking_persistence__"),
  );
  const serialized = JSON.stringify(report);

  assert.equal(report.status, "critical");
  assert.equal(bookingCheck?.status, "critical");
  assert.equal(bookingCheck?.error, "required_store_missing");
  assert.equal(
    new URL(bookingRequest).searchParams.get("select"),
    "slug,blocks,updated_at",
  );
  assert.deepEqual(
    bookingCheck?.stores.map((store) => Object.keys(store)),
    VALID_BOOKING_ROWS.map(() => ["slug", "entryCount", "updatedAt"]),
  );
  assert.equal(serialized.includes("blocks"), false);
  assert.equal(serialized.includes(privateBlockMarker), false);
});

test("production operations monitor evaluates outbox health after every migration is ready", async () => {
  const migrationRows = discoverRequiredMigrationVersions().map((version) => ({
    version,
  }));
  const router = createFetchRouter({
    migrationRows,
    outboxHealth: {
      dead_letter_count: 1,
      expired_lease_count: 0,
      unknown_event_type_count: 0,
      oldest_due_age_seconds: 0,
    },
  });
  const report = await runProductionOperationsCheck(
    monitorOptions(router.fetchImpl),
  );

  assert.equal(
    report.checks.find((check) => check.name === "v1_migrations")?.status,
    "healthy",
  );
  assert.equal(
    report.checks.find((check) => check.name === "outbox_v1")?.status,
    "critical",
  );
  assert.equal(report.status, "critical");
});

test("production operations report never includes response bodies or credentials", async () => {
  const router = createFetchRouter({
    authResponse: jsonResponse(
      {
        code: "AUTH401",
        message: "service-test-key should never be reported",
      },
      { status: 401 },
    ),
  });
  const report = await runProductionOperationsCheck(
    monitorOptions(router.fetchImpl),
  );
  const serialized = JSON.stringify(report);

  assert.equal(report.status, "critical");
  assert.equal(serialized.includes("service-test-key"), false);
  assert.equal(serialized.includes("should never be reported"), false);
  assert.equal(serialized.includes("AUTH401"), true);
});
