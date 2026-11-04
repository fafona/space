import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./MerchantBookingManagerDialog.tsx", import.meta.url), "utf8");
const actions = source.slice(source.indexOf("const renderStatusActions ="), source.indexOf("if (!open) return null;", source.indexOf("const renderStatusActions =")));

test("booking status variants retain semantic action slots and existing permission and mutation handlers", () => {
  assert.deepEqual([...actions.matchAll(/data-booking-action-slot="([a-z]+)"/g)].map(match => match[1]),
    ["status", "completion", "status", "status", "attendance", "completion", "cancel"]);
  assert.match(actions, /if \(!canManageBookingStatus\) return null/);
  for (const [status, action] of [["active", "restore"], ["confirmed", "uncomplete"], ["active", "unconfirm"],
    ["confirmed", "confirm"], ["no_show", "noshow"], ["completed", "complete"], ["cancelled", "cancel"]]) {
    assert.ok(actions.includes(`patchBooking(record.id, { status: "${status}" }, "${action}")`));
    assert.ok(actions.includes(`disabled={busyKey === \`${action}:\${record.id}\`}`));
  }
});

test("booking layout reserves missing slots, prevents contact shrink and anchors the detail button", () => {
  assert.match(source, /w-\[23\.125rem\]/);
  assert.match(source, /sm:grid-cols-\[6rem_6rem_5rem_5rem\]/);
  assert.match(source, /auto-rows-\[34px\]/);
  assert.match(source, /data-booking-action-slot=status\]\]:col-start-1/);
  assert.match(source, /data-booking-action-slot=attendance\]\]:col-start-2/);
  assert.match(source, /sm:\[&>\[data-booking-action-slot=completion\]\]:col-start-3/);
  assert.match(source, /sm:\[&>\[data-booking-action-slot=cancel\]\]:col-start-4/);
  assert.match(source, /w-\[580px\] max-w-full min-w-0 shrink-0/);
  assert.doesNotMatch(source, /min-w-\[580px\]/);
  assert.match(source, /data-booking-action-slot="details"/);
  assert.match(source, /min-w-0 items-end justify-end/);
});
