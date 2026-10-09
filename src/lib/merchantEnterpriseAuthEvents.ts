type SessionIdentity = { access_token: string; refresh_token: string; user: { id: string } };

function sessionIdentity(value: unknown): SessionIdentity | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<SessionIdentity>;
  return typeof session.access_token === "string" && session.access_token.length > 0 &&
    typeof session.refresh_token === "string" && session.refresh_token.length > 0 &&
    typeof session.user?.id === "string" && session.user.id.length > 0
    ? session as SessionIdentity : null;
}

/**
 * Supabase broadcasts auth events even when its storage adapter is tab-local.
 * A received broadcast does NOT update that tab's saved session. Filter before
 * consumers advance their auth generation, start requests or mutate UI state.
 *
 * Own SDK transitions save/remove the session before notifying subscribers.
 * Read storage synchronously: calling getSession inside an auth callback can
 * deadlock the SDK lock. This is UI isolation, not server-side authorization.
 */
export function shouldApplyEnterpriseAuthEvent(
  session: unknown,
  readStoredSession: () => string | null,
  isLogoutBlocked: () => boolean,
): boolean {
  // The logout boundary can lend the old credential to the SDK solely for
  // remote revocation. It must never reopen the UI during/after logout.
  if (isLogoutBlocked()) return session === null;
  let stored: SessionIdentity | null = null;
  try {
    const raw = readStoredSession();
    stored = raw === null ? null : sessionIdentity(JSON.parse(raw));
  } catch {
    // Unreadable/invalid persistence cannot authorize a signed-in event.
  }
  if (session === null) return stored === null;
  const incoming = sessionIdentity(session);
  return Boolean(stored && incoming &&
    incoming.access_token === stored.access_token &&
    incoming.refresh_token === stored.refresh_token &&
    incoming.user.id === stored.user.id);
}
