import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPersonalGuestSupportMessage,
  archiveAndClearPersonalGuestData,
  buildPersonalGuestMigrationFingerprint,
  buildPersonalGuestSessionPayload,
  ensurePersonalGuestIdentity,
  hasPersonalGuestMigrationCompleted,
  markPersonalGuestMigrationCompleted,
  readPersonalGuestBookings,
  readPersonalGuestFavoriteSites,
  readPersonalGuestMergeToken,
  readPersonalGuestOrders,
  readPersonalGuestProfile,
  readPersonalGuestSupportMessages,
  savePersonalGuestFavoriteSites,
  savePersonalGuestProfile,
  upsertPersonalGuestBooking,
  upsertPersonalGuestOrder,
} from "@/lib/personalGuestSession";

class MemoryStorage implements Storage {
  #store = new Map<string, string>();

  get length() {
    return this.#store.size;
  }

  clear() {
    this.#store.clear();
  }

  getItem(key: string) {
    return this.#store.has(key) ? this.#store.get(key) ?? null : null;
  }

  key(index: number) {
    return Array.from(this.#store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.#store.delete(key);
  }

  setItem(key: string, value: string) {
    this.#store.set(key, String(value));
  }
}

function installWindowStorage() {
  const previousWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const windowMock = {
    localStorage,
    dispatchEvent() {
      return true;
    },
    parent: null,
  } as unknown as Window & typeof globalThis;
  windowMock.parent = windowMock;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });
  return {
    localStorage,
    restore() {
      if (typeof previousWindow === "undefined") {
        Reflect.deleteProperty(globalThis, "window");
        return;
      }
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    },
  };
}

function createOrder(id = "O10000000202607040001") {
  return {
    id,
    siteId: "10000000",
    siteName: "Demo shop",
    blockId: "product-block",
    customerGuestHash: "sha256:guest-order",
    createdAt: "2026-07-04T10:00:00.000Z",
    updatedAt: "2026-07-04T10:00:00.000Z",
    status: "pending",
    customer: {
      name: "Guest",
      phone: "",
      email: "",
      note: "",
    },
    items: [
      {
        productId: "p1",
        code: "SKU-001",
        name: "Demo product",
        description: "",
        imageUrl: "",
        tag: "",
        quantity: 1,
        unitPrice: 9,
        unitPriceText: "€9.00",
      },
    ],
    pricePrefix: "€",
  };
}

function createBooking(id = "B10000000202607040001") {
  return {
    id,
    siteId: "10000000",
    siteName: "Demo shop",
    store: "Store",
    item: "Service",
    appointmentAt: "2026-07-08T10:00:00.000Z",
    title: "Booking",
    customerName: "Guest",
    email: "",
    phone: "",
    note: "",
    customerGuestHash: "sha256:guest-booking",
    status: "active",
    createdAt: "2026-07-04T10:05:00.000Z",
    updatedAt: "2026-07-04T10:05:00.000Z",
  };
}

test("guest identity stays stable and builds a personal guest payload", () => {
  const harness = installWindowStorage();
  try {
    const first = ensurePersonalGuestIdentity();
    const second = ensurePersonalGuestIdentity();

    assert.equal(first.id, second.id);
    assert.match(first.accountId, /^\d{8}$/);
    assert.equal(readPersonalGuestMergeToken(first), first.id);

    const payload = buildPersonalGuestSessionPayload(first, { ...readPersonalGuestProfile(), displayName: "Visitor" });
    assert.equal(payload.authenticated, false);
    assert.equal(payload.accountType, "personal");
    assert.equal(payload.accountId, first.accountId);
    assert.equal(payload.guest, true);
    assert.equal(payload.user.user_metadata.personal_profile.displayName, "Visitor");
  } finally {
    harness.restore();
  }
});

test("guest migration fingerprint and completion marker are account scoped", () => {
  const harness = installWindowStorage();
  try {
    const identity = ensurePersonalGuestIdentity();
    const fingerprint = buildPersonalGuestMigrationFingerprint({
      identity,
      profile: { ...readPersonalGuestProfile(), displayName: "Guest A" },
      favoriteSites: [{ id: "site-1", url: "https://demo.faolla.com" }],
      orders: [],
      bookings: [],
      supportMessages: [],
    });

    assert.equal(hasPersonalGuestMigrationCompleted("12345678", fingerprint), false);
    markPersonalGuestMigrationCompleted("12345678", fingerprint);
    assert.equal(hasPersonalGuestMigrationCompleted("12345678", fingerprint), true);
    assert.equal(hasPersonalGuestMigrationCompleted("87654321", fingerprint), false);
    assert.equal(hasPersonalGuestMigrationCompleted("12345678", `${fingerprint}:changed`), false);
  } finally {
    harness.restore();
  }
});

test("archiving clears only requested guest caches and keeps a local archive snapshot", () => {
  const harness = installWindowStorage();
  try {
    const identity = ensurePersonalGuestIdentity();
    savePersonalGuestProfile({ displayName: "Temporary guest", email: "guest@example.com" });
    savePersonalGuestFavoriteSites([{ id: "site-1", url: "https://demo.faolla.com", name: "Demo" }]);
    upsertPersonalGuestOrder(createOrder());
    upsertPersonalGuestBooking(createBooking());
    appendPersonalGuestSupportMessage("hello Faolla", identity, readPersonalGuestProfile());

    const ordersBefore = readPersonalGuestOrders();
    const bookingsBefore = readPersonalGuestBookings();
    const supportBefore = readPersonalGuestSupportMessages();
    const fingerprint = buildPersonalGuestMigrationFingerprint({
      identity,
      profile: readPersonalGuestProfile(),
      favoriteSites: readPersonalGuestFavoriteSites(),
      orders: ordersBefore,
      bookings: bookingsBefore,
      supportMessages: supportBefore,
    });

    archiveAndClearPersonalGuestData({
      accountId: "12345678",
      fingerprint,
      clearProfile: true,
      clearFavorites: true,
      clearOrders: false,
      clearBookings: true,
      clearSupport: true,
    });

    assert.equal(readPersonalGuestProfile().displayName, "");
    assert.equal(readPersonalGuestFavoriteSites().length, 0);
    assert.equal(readPersonalGuestBookings().length, 0);
    assert.equal(readPersonalGuestSupportMessages().length, 0);
    assert.equal(readPersonalGuestOrders().length, 1);

    const archives = JSON.parse(String(harness.localStorage.getItem("faolla:personal-guest-archives:v1")));
    assert.equal(Array.isArray(archives), true);
    assert.equal(archives[0].accountId, "12345678");
    assert.equal(archives[0].profile.displayName, "Temporary guest");
    assert.equal(archives[0].orders.length, 1);
    assert.equal(archives[0].bookings.length, 1);
    assert.equal(archives[0].supportMessages.length, 1);
    assert.deepEqual(archives[0].cleared, {
      profile: true,
      favorites: true,
      orders: false,
      bookings: true,
      support: true,
    });
  } finally {
    harness.restore();
  }
});
