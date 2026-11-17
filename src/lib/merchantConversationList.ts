import { GUEST_CHAT_UUID, type GuestChatThread } from "./guestChat";

export type MerchantConversationRow = {
  key: string;
  name: string;
  badge?: string;
  unreadCount: number;
  subtitle: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  avatarLabel: string;
  avatarImageUrl?: string;
  accountType?: "merchant" | "personal";
  isOfficial: boolean;
};

// Display numbers are never account identifiers. Only the server thread UUID
// selects a visitor conversation, even when its number matches an account ID.
export function guestConversationId(key: string) {
  const id = key.startsWith("guest:") ? key.slice(6) : "";
  return GUEST_CHAT_UUID.test(id) ? id : "";
}

export function mergeMerchantConversations(
  accounts: readonly MerchantConversationRow[],
  guests: readonly GuestChatThread[],
): MerchantConversationRow[] {
  const visitors = guests.map((thread): MerchantConversationRow => ({
    key: `guest:${thread.id}`,
    name: thread.guestName,
    unreadCount: thread.unread,
    subtitle: "游客",
    preview: thread.lastMessage?.text || "暂无消息。",
    updatedAt: thread.updatedAt,
    unread: thread.unread > 0,
    avatarLabel: "客",
    isOfficial: false,
  }));
  const timestamp = (value: string) => Date.parse(value) || 0;
  return [...accounts, ...visitors].sort((a, b) =>
    Number(b.isOfficial) - Number(a.isOfficial) ||
    timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.key.localeCompare(b.key),
  );
}
