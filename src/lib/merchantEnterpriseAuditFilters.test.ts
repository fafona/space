import assert from "node:assert/strict";
import test from "node:test";

import {
  appendMerchantEnterpriseAuditActorFilter,
  buildMerchantEnterpriseAuditUtcRange,
} from "./merchantEnterpriseAuditFilters";

test("builds an inclusive UI date range as a UTC left-closed/right-open query", () => {
  assert.deepEqual(
    buildMerchantEnterpriseAuditUtcRange({
      startDate: "2026-08-01",
      endDate: "2026-08-18",
    }),
    {
      ok: true,
      createdFrom: "2026-08-01T00:00:00.000Z",
      createdToExclusive: "2026-08-19T00:00:00.000Z",
    },
  );
});

test("supports open boundaries and rejects invalid or reversed dates", () => {
  assert.deepEqual(
    buildMerchantEnterpriseAuditUtcRange({ startDate: "", endDate: "2026-08-18" }),
    { ok: true, createdToExclusive: "2026-08-19T00:00:00.000Z" },
  );
  assert.equal(
    buildMerchantEnterpriseAuditUtcRange({
      startDate: "2026-02-30",
      endDate: "",
    }).ok,
    false,
  );
  assert.equal(
    buildMerchantEnterpriseAuditUtcRange({
      startDate: "2026-08-19",
      endDate: "2026-08-18",
    }).ok,
    false,
  );
});

test("adds exact actor query parameters without treating all as a server filter", () => {
  const employeeParams = new URLSearchParams();
  appendMerchantEnterpriseAuditActorFilter(
    employeeParams,
    "employee:123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(employeeParams.get("actorType"), "employee");
  assert.equal(
    employeeParams.get("actorId"),
    "123e4567-e89b-42d3-a456-426614174000",
  );

  const ownerParams = new URLSearchParams();
  appendMerchantEnterpriseAuditActorFilter(ownerParams, "owner");
  assert.equal(ownerParams.toString(), "actorType=owner");

  const allParams = new URLSearchParams();
  appendMerchantEnterpriseAuditActorFilter(allParams, "all");
  assert.equal(allParams.toString(), "");
});
