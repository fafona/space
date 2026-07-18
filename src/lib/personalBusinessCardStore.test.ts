import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantBusinessCardDraft } from "./merchantBusinessCards";
import {
  loadStoredPersonalBusinessCards,
  type PersonalBusinessCardStoreClient,
} from "./personalBusinessCardStore";

type QueryResult = { data: unknown; error: unknown };

function createLoadClient(input: {
  scoped: QueryResult;
  fallback?: QueryResult;
}) {
  const maybeSingle = (result: QueryResult) => async () => result;
  return {
    from: () => ({
      select: () => ({
        is: () => ({
          eq: () => ({
            limit: () => ({ maybeSingle: maybeSingle(input.scoped) }),
          }),
        }),
        eq: () => ({
          limit: () => ({ maybeSingle: maybeSingle(input.fallback ?? input.scoped) }),
        }),
      }),
    }),
  } as unknown as PersonalBusinessCardStoreClient;
}

test("personal business card storage distinguishes an empty record from a read failure", async () => {
  const empty = await loadStoredPersonalBusinessCards(
    createLoadClient({ scoped: { data: null, error: null } }),
    "10000001",
  );

  assert.deepEqual(empty, {
    accountId: "10000001",
    cards: [],
    updatedAt: null,
  });

  await assert.rejects(
    loadStoredPersonalBusinessCards(
      createLoadClient({ scoped: { data: null, error: { message: "database timeout" } } }),
      "10000001",
    ),
    /personal_business_cards_load_failed:database timeout/,
  );
});

test("personal business card storage reads and normalizes saved cards", async () => {
  const draft = createDefaultMerchantBusinessCardDraft({
    merchantName: "Personal card",
    domainPrefix: "10000001",
  });
  const stored = await loadStoredPersonalBusinessCards(
    createLoadClient({
      scoped: {
        data: {
          blocks: {
            cards: [
              {
                ...draft,
                id: "card-1",
                createdAt: "2026-07-18T00:00:00.000Z",
                imageUrl: "https://faolla.com/card.png",
                targetUrl: "https://faolla.com/u/10000001",
              },
            ],
          },
          updated_at: "2026-07-18T01:00:00.000Z",
        },
        error: null,
      },
    }),
    "10000001",
  );

  assert.equal(stored?.cards.length, 1);
  assert.equal(stored?.cards[0]?.id, "card-1");
  assert.equal(stored?.updatedAt, "2026-07-18T01:00:00.000Z");
});

test("personal business card storage supports schemas without merchant_id", async () => {
  const stored = await loadStoredPersonalBusinessCards(
    createLoadClient({
      scoped: {
        data: null,
        error: { message: "column pages.merchant_id does not exist" },
      },
      fallback: {
        data: { blocks: { cards: [] }, updated_at: null },
        error: null,
      },
    }),
    "10000001",
  );

  assert.equal(stored?.accountId, "10000001");
  assert.deepEqual(stored?.cards, []);
});
