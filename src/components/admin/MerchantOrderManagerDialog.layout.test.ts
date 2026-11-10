import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./MerchantOrderManagerDialog.tsx", import.meta.url), "utf8");
const listActions = source.slice(source.indexOf("const renderStatusActions = useCallback("), source.indexOf("const isSidebarWorkbenchMode"));

test("order list status variants stay in fixed semantic slots without changing selection guards", () => {
  const slots = [...listActions.matchAll(/data-order-action-slot="([a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(slots, ["status", "status", "status", "completion", "completion", "cancel"]);
  assert.equal([...listActions.matchAll(/data-skip-selection-toggle="true"/g)].length, slots.length);
  assert.match(listActions, /canManageOrderStatus/);
  assert.match(listActions, /canCompleteOrders/);
  assert.match(source, /data-order-action-slot="details"/);
});

test("list action and contact columns cannot size themselves to the current status button count", () => {
  assert.match(source, /w-\[19\.125rem\] max-w-full shrink-0/);
  assert.match(source, /sm:grid-cols-\[6rem_5rem_3\.5rem_3\.5rem\]/);
  assert.match(source, /auto-rows-\[34px\]/);
  assert.match(source, /\[&>button\]:whitespace-nowrap/);
  assert.match(source, /data-order-action-slot=status\]\]:col-start-1/);
  assert.match(source, /data-order-action-slot=completion\]\]:col-start-2/);
  assert.match(source, /sm:\[&>\[data-order-action-slot=cancel\]\]:col-start-3/);
  assert.match(source, /sm:\[&>\[data-order-action-slot=details\]\]:col-start-4/);
  assert.match(source, /w-\[580px\] max-w-full min-w-0 shrink-0/);
  assert.doesNotMatch(source, /min-w-\[580px\]/);
});
