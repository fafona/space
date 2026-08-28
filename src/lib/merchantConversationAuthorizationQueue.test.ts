import assert from "node:assert/strict";
import test from "node:test";
import {
  saveMerchantPeerInbox,
  type MerchantPeerInboxStoreClient,
} from "@/lib/merchantPeerInboxStore";
import {
  saveMerchantSupportReadState,
  type MerchantSupportReadStateStoreClient,
} from "@/lib/merchantSupportReadStateStore";

test("peer inbox authorization runs inside the write queue before any canonical read", async () => {
  let reads = 0;
  const sentinel = new Error("permission_revoked");
  const client = {
    from() {
      reads += 1;
      throw new Error("store must not be read");
    },
  } as unknown as MerchantPeerInboxStoreClient;

  await assert.rejects(
    saveMerchantPeerInbox(
      client,
      { contacts: [], threads: [] },
      {
        async beforeMutation() {
          throw sentinel;
        },
      },
    ),
    (error) => error === sentinel,
  );
  assert.equal(reads, 0);
});

test("conversation read-state authorization runs inside the queue before any canonical read", async () => {
  let reads = 0;
  const sentinel = new Error("permission_revoked");
  const client = {
    from() {
      reads += 1;
      throw new Error("store must not be read");
    },
  } as unknown as MerchantSupportReadStateStoreClient;

  await assert.rejects(
    saveMerchantSupportReadState(
      client,
      { accounts: [] },
      {
        async beforeMutation() {
          throw sentinel;
        },
      },
    ),
    (error) => error === sentinel,
  );
  assert.equal(reads, 0);
});
