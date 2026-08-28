import assert from "node:assert/strict";
import test from "node:test";
import { withMerchantMembershipMutationLock } from "@/lib/merchantMemberships.server";
import { withMerchantMembershipSettingsMutationLock } from "@/lib/merchantMembershipSettings.server";

async function assertQueuedRevocation(
  runLocked: <T>(
    siteId: string,
    task: () => Promise<T>,
    beforeMutation?: () => Promise<void>,
  ) => Promise<T>,
) {
  const events: string[] = [];
  let releaseFirst!: () => void;
  let firstEntered!: () => void;
  const firstReady = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  const holdFirst = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = runLocked("10000000", async () => {
    events.push("first-task");
    firstEntered();
    await holdFirst;
    events.push("first-finished");
    return true;
  });
  await firstReady;

  let secondTaskRan = false;
  const second = runLocked(
    "10000000",
    async () => {
      secondTaskRan = true;
      return true;
    },
    async () => {
      events.push("second-reauthorize");
      throw new Error("permission_denied");
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first-task"]);

  releaseFirst();
  await first;
  await assert.rejects(second, /permission_denied/);
  assert.deepEqual(events, ["first-task", "first-finished", "second-reauthorize"]);
  assert.equal(secondTaskRan, false);
}

test("membership financial mutation reauthorizes after waiting for the site lock", async () => {
  await assertQueuedRevocation(withMerchantMembershipMutationLock);
});

test("membership settings mutation reauthorizes after waiting for the site lock", async () => {
  await assertQueuedRevocation(withMerchantMembershipSettingsMutationLock);
});
