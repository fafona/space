// Visitor ids are a different namespace. Eight digits are display-only, never
// accepted as authentication or converted to a platform/merchant account id.
export type GuestChatMessage = { id: string; requestId: string; sender: "guest" | "merchant"; text: string; createdAt: string };
export type GuestChatThread = { id: string; siteId: string; guestNumber: string; guestName: string; updatedAt: string; unread: number; lastMessage: GuestChatMessage | null };
export type GuestChatPayload = { ok: true; guest?: { guestNumber: string; guestName: string } | null; threads?: GuestChatThread[]; thread?: GuestChatThread | null; messages?: GuestChatMessage[]; before?: string | null; nextOffset?: number | null };
export const GUEST_CHAT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const guestChatName = (number: string) => `游客${number}`;
