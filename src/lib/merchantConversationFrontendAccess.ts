import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

export type MerchantConversationFrontendAccess = Readonly<{
  view: boolean;
  search: boolean;
  start: boolean;
  send: boolean;
}>;

export function getMerchantConversationFrontendAccess(
  permissions: readonly MerchantStaffBusinessPermission[],
): MerchantConversationFrontendAccess {
  const selected = new Set(permissions);
  const view = selected.has("conversations.view");
  return {
    view,
    search: view && selected.has("conversations.search"),
    start:
      view &&
      selected.has("conversations.search") &&
      selected.has("conversations.start"),
    send: view && selected.has("conversations.send"),
  };
}
