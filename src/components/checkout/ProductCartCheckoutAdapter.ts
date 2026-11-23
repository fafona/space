import type { ReactNode } from "react";
import type { CheckoutCustomerDraft } from "@/lib/merchantCheckoutClient";
import type { CartClientOriginal, CartClientSelection } from "@/lib/merchantCheckoutCartReview";
import type { ProductCheckoutDraftLine } from "@/lib/merchantCheckoutProductCart";
import type { AccountCartDraft } from "@/lib/merchantCheckoutAccountDraft";
import type { CheckoutDraftLease } from "@/lib/merchantCheckoutDraftLease";
export type ProductCartCheckoutHost = { items: ProductCheckoutDraftLine[]; customer: CheckoutCustomerDraft; clientRequestId: string; storageKey: string; serializedDraft: string | null;
  persist: (expected: string | null, customer: CheckoutCustomerDraft, ack?: { selection: CartClientSelection; original: CartClientOriginal; fresh: boolean }, lease?: CheckoutDraftLease) => string | Promise<string> };
export type ProductCartCheckoutAdapter = { ownedDraft?: AccountCartDraft | null; isLocked: () => boolean; render: (host: ProductCartCheckoutHost) => ReactNode };
