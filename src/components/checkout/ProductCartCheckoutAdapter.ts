import type { ReactNode } from "react";
import type { CheckoutCustomerDraft } from "@/lib/merchantCheckoutClient";
import type { CartClientOriginal, CartClientSelection } from "@/lib/merchantCheckoutCartReview";
import type { ProductCheckoutDraftLine } from "@/lib/merchantCheckoutProductCart";
export type ProductCartCheckoutHost = { items: ProductCheckoutDraftLine[]; customer: CheckoutCustomerDraft; clientRequestId: string; storageKey: string; serializedDraft: string;
  persist: (expected: string | null, customer: CheckoutCustomerDraft, ack?: { selection: CartClientSelection; original: CartClientOriginal; fresh: boolean }) => string };
export type ProductCartCheckoutAdapter = { isLocked: () => boolean; render: (host: ProductCartCheckoutHost) => ReactNode };
