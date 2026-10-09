type InvitationSessionIdentity = {
  access_token?: string;
  user?: { id?: string } | null;
} | null | undefined;

export class EnterpriseInvitationSessionError extends Error {
  constructor(readonly reason: "session_missing" | "account_mismatch") {
    super(reason === "account_mismatch"
      ? "请使用该邀请已验证的员工账号登录后重试。"
      : "登录会话已失效，请使用受邀员工邮箱和密码重新登录。");
    this.name = "EnterpriseInvitationSessionError";
  }
}

/**
 * Synchronous client handoff guard, not server authentication/authorization.
 * Call with the SDK session just obtained by sign-in/getSession, before changing
 * invitation stage or submitting acceptance. Never discard the invitation here.
 */
export function requireEnterpriseInvitationSession(
  session: InvitationSessionIdentity,
  invitationAuthUserId: string | null,
  logoutBlocked: boolean,
): string {
  const token = session?.access_token;
  if (logoutBlocked || typeof token !== "string" || !token.trim()) {
    throw new EnterpriseInvitationSessionError("session_missing");
  }
  if (!invitationAuthUserId || session?.user?.id !== invitationAuthUserId) {
    throw new EnterpriseInvitationSessionError("account_mismatch");
  }
  return token;
}
