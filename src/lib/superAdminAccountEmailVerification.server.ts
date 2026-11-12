import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidAuthAccount, isValidAuthEmail, normalizeAuthEmail } from "./authCredentialValidation";
import { readPlatformAccountIdFromMetadata, readPlatformAccountTypeHintFromMetadata } from "./platformAccounts";
import { readSuperAdminAuthorizedSession } from "./superAdminRequestAuth";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";

type Dependencies = {
  session: typeof readSuperAdminAuthorizedSession;
  trusted: typeof isTrustedSameOriginMutationRequest;
};
const dependencies: Dependencies = {session: readSuperAdminAuthorizedSession, trusted: isTrustedSameOriginMutationRequest};
type Client = Pick<SupabaseClient["auth"]["admin"], "getUserById" | "updateUserById">;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {status, headers: {"Cache-Control": "private, no-store", "Vary": "Cookie"}});
}

/** One explicitly selected account only. Never creates an identity or a session. */
export async function verifySuperAdminAccountEmail(request: Request, input: unknown, admin: Client, deps = dependencies) {
  if (!deps.trusted(request)) return json({message: "请求来源不可信"}, 403);
  const session = await deps.session(request);
  if (!session) return json({message: "请重新登录超级后台"}, 401);
  const p = input as Record<string, unknown> | null;
  const authUserId = typeof p?.authUserId === "string" ? p.authUserId.trim() : "";
  const accountId = typeof p?.accountId === "string" ? p.accountId.trim() : "";
  const accountType = p?.accountType;
  const email = normalizeAuthEmail(p?.email);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUserId) ||
      !(accountType === "personal" ? isValidAuthAccount(accountId) : /^\d{8}$/.test(accountId)) || !["merchant", "personal"].includes(String(accountType)) ||
      !isValidAuthEmail(email) || p?.confirmed !== true) {
    return json({message: "请明确选择账号，并确认已人工核实注册人身份"}, 400);
  }
  const matches = (user: Awaited<ReturnType<Client["getUserById"]>>["data"]["user"]) => !!user &&
    user.id.toLowerCase() === authUserId.toLowerCase() && normalizeAuthEmail(user.email) === email &&
    readPlatformAccountIdFromMetadata(user) === accountId && readPlatformAccountTypeHintFromMetadata(user, "") === accountType;
  try {
    const current = await admin.getUserById(authUserId);
    if (current.error || !current.data.user) return json({message: "无法读取该账号的验证状态，请刷新后重试"}, 503);
    const user = current.data.user;
    if (!matches(user)) return json({message: "账号绑定或邮箱已变化，请刷新列表后重新确认"}, 409);
    if (user.deleted_at || (user.banned_until && new Date(user.banned_until).getTime() > Date.now()))
      return json({message: "该账号已删除或被禁用，不能通过验证解除限制"}, 409);
    const result = (confirmedAt: string, alreadyVerified: boolean) => json({verification: {
      authUserId: user.id, accountId, accountType, email, emailConfirmed: true,
      emailVerificationKnown: true, emailConfirmedAt: confirmedAt,
    }, alreadyVerified});
    if (user.email_confirmed_at) return result(user.email_confirmed_at, true);
    // GoTrue merges top-level app_metadata keys. Do not resend a stale copy of
    // service settings, roles or permissions. This audit key is admin-write-only.
    const updated = await admin.updateUserById(user.id, {
      email_confirm: true,
      app_metadata: {faolla_email_verification: {version: 1, method: "super_admin", at: new Date().toISOString(),
        eventId: randomUUID(), deviceId: session.deviceId}},
    });
    if (updated.error || !matches(updated.data.user) || !updated.data.user?.email_confirmed_at)
      return json({message: "暂时无法确认验证结果，请刷新账号状态；请勿重复创建账号"}, 503);
    return result(updated.data.user.email_confirmed_at, false);
  } catch {
    return json({message: "暂时无法确认验证结果，请刷新账号状态后再试"}, 503);
  }
}
