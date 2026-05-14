import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlatformAccountIdentityForUser } from "@/lib/platformAccountIdentity";

test("personal platform identity allocates from the personal range and persists metadata", async () => {
  const updates: Array<{ userId: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }> =
    [];

  const client = {
    auth: {
      admin: {
        async listUsers() {
          return {
            data: {
              users: [
                {
                  id: "user-a",
                  user_metadata: {
                    account_type: "personal",
                    account_id: "50010105",
                  },
                },
              ],
            },
            error: null,
          };
        },
        async updateUserById(userId: string, attributes: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }) {
          updates.push({ userId, ...attributes });
          return {
            data: {
              user: {
                id: userId,
                user_metadata: attributes.user_metadata ?? null,
                app_metadata: attributes.app_metadata ?? null,
              },
            },
            error: null,
          };
        },
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                limit() {
                  return Promise.resolve({
                    data: [],
                    error: null,
                  });
                },
              };
            },
          };
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const identity = await resolvePlatformAccountIdentityForUser(client, {
    id: "user-b",
    email: "personal@example.com",
    user_metadata: {
      account_type: "personal",
    },
  }, {
    preferredAccountType: "personal",
  });

  assert.equal(identity.accountType, "personal");
  assert.equal(identity.accountId, "50010106");
  assert.equal(updates[0]?.userId, "user-b");
  assert.equal(updates[0]?.user_metadata?.personal_id, "50010106");
});

test("personal platform identity preserves explicit non-range account ids", async () => {
  const updates: Array<{ userId: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }> =
    [];

  const client = {
    auth: {
      admin: {
        async listUsers() {
          return {
            data: { users: [] },
            error: null,
          };
        },
        async updateUserById(userId: string, attributes: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }) {
          updates.push({ userId, ...attributes });
          return {
            data: {
              user: {
                id: userId,
                user_metadata: attributes.user_metadata ?? null,
                app_metadata: attributes.app_metadata ?? null,
              },
            },
            error: null,
          };
        },
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                limit() {
                  return Promise.resolve({
                    data: [],
                    error: null,
                  });
                },
              };
            },
          };
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const identity = await resolvePlatformAccountIdentityForUser(client, {
    id: "user-c",
    email: "personal-outside-range@example.com",
    user_metadata: {
      account_type: "personal",
      account_id: "10000001",
      personal_id: "10000001",
    },
  });

  assert.equal(identity.accountType, "personal");
  assert.equal(identity.accountId, "10000001");
  assert.equal(updates[0]?.userId, "user-c");
  assert.equal(updates[0]?.user_metadata?.personal_id, "10000001");
});

test("personal platform identity preserves explicit non-numeric account ids", async () => {
  const updates: Array<{ userId: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }> =
    [];

  const client = {
    auth: {
      admin: {
        async listUsers() {
          return {
            data: { users: [] },
            error: null,
          };
        },
        async updateUserById(userId: string, attributes: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }) {
          updates.push({ userId, ...attributes });
          return {
            data: {
              user: {
                id: userId,
                user_metadata: attributes.user_metadata ?? null,
                app_metadata: attributes.app_metadata ?? null,
              },
            },
            error: null,
          };
        },
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                limit() {
                  return Promise.resolve({
                    data: [],
                    error: null,
                  });
                },
              };
            },
          };
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const identity = await resolvePlatformAccountIdentityForUser(client, {
    id: "user-d",
    email: "personal-nonnumeric@example.com",
    user_metadata: {
      account_type: "personal",
      account_id: "personal-min",
      personal_id: "personal-min",
    },
  });

  assert.equal(identity.accountType, "personal");
  assert.equal(identity.accountId, "personal-min");
  assert.equal(updates[0]?.userId, "user-d");
  assert.equal(updates[0]?.user_metadata?.personal_id, "personal-min");
});
