import assert from "node:assert/strict";
import test from "node:test";
import {
  loadStoredMerchantCustomerDirectory,
  mergeStoredMerchantCustomerDirectoryRows,
  type MerchantCustomerDirectoryStoreClient,
} from "@/lib/merchantCustomerDirectoryStore";
import { createEmptyMerchantCustomerProfile } from "@/lib/merchantCustomers";

function createReadClient(result: {
  data: unknown;
  error: unknown;
}): MerchantCustomerDirectoryStoreClient {
  const query = {
    select: () => query,
    eq: () => query,
    then: (
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return { from: () => query };
}

test("customer directory store uses the newest complete snapshot", () => {
  const oldCustomer = createEmptyMerchantCustomerProfile("10000000");
  oldCustomer.id = "customer-1";
  oldCustomer.displayName = "Old";
  const newCustomer = {
    ...oldCustomer,
    displayName: "New",
    updatedAt: "2026-07-02T00:00:00.000Z",
  };
  const merged = mergeStoredMerchantCustomerDirectoryRows("10000000", [
    {
      id: "old",
      slug: "__merchant_customer_directory__:10000000",
      blocks: { customers: [oldCustomer] },
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "new",
      slug: "__merchant_customer_directory__:10000000",
      blocks: {
        customers: [newCustomer],
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      updated_at: "2026-07-02T00:00:00.000Z",
    },
  ]);

  assert.ok(merged);
  assert.equal(merged?.customers.length, 1);
  assert.equal(merged?.customers[0]?.displayName, "New");
  assert.equal(merged?.updatedAt, "2026-07-02T00:00:00.000Z");
});

test("customer directory store propagates unexpected read failures", async () => {
  const client = createReadClient({
    data: null,
    error: { message: "upstream timeout" },
  });
  await assert.rejects(
    () => loadStoredMerchantCustomerDirectory(client, "10000000"),
    /merchant_customer_directory_read_failed:upstream timeout/,
  );
});

test("customer directory store treats a legacy schema without slug as empty", async () => {
  const client = createReadClient({
    data: null,
    error: { message: "column pages.slug does not exist" },
  });
  assert.equal(
    await loadStoredMerchantCustomerDirectory(client, "10000000"),
    null,
  );
});
