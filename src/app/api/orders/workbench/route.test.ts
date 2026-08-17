import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantOrderWorkbenchGet,
  type MerchantOrderWorkbenchRouteDependencies,
} from "@/app/api/orders/workbench/route";

const SITE_ID = "10000000";
type SnapshotSite = NonNullable<
  Awaited<ReturnType<MerchantOrderWorkbenchRouteDependencies["loadSnapshotSite"]>>
>;

test("GET rejects a workbench read when order management is disabled", async () => {
  let listCalls = 0;
  const response = await handleMerchantOrderWorkbenchGet(
    new Request(`https://merchant.faolla.test/api/orders/workbench?siteId=${SITE_ID}`),
    {
      async resolveSession(_request, siteId) {
        assert.equal(siteId, SITE_ID);
        return { merchantId: SITE_ID };
      },
      async loadSnapshotSite(siteId) {
        assert.equal(siteId, SITE_ID);
        return {
          id: SITE_ID,
          permissionConfig: {
            allowProductBlock: true,
            allowOrderManagement: false,
          },
        } as SnapshotSite;
      },
      async listOrders() {
        listCalls += 1;
        return [];
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "order_management_disabled" });
  assert.equal(listCalls, 0);
});
