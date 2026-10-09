import assert from "node:assert/strict";
import test from "node:test";
import {
  EnterpriseInvitationSessionError,
  requireEnterpriseInvitationSession,
} from "./merchantEnterpriseInvitationSession";

const invitedId = "00000000-0000-4000-8000-000000000001";
const anotherId = "00000000-0000-4000-8000-000000000002";

test("matching SDK session returns its exact token without modifying session or invitation", () => {
  const session = Object.freeze({ access_token: "synthetic-token", user: Object.freeze({ id: invitedId }) });
  assert.equal(requireEnterpriseInvitationSession(session, invitedId, false), "synthetic-token");
  assert.deepEqual(session, { access_token: "synthetic-token", user: { id: invitedId } });
});

test("different or absent session subject cannot continue a bound invitation", () => {
  for (const user of [{ id: anotherId }, { id: "" }, {}, null, undefined]) {
    assert.throws(() => requireEnterpriseInvitationSession({ access_token: "synthetic-token", user }, invitedId, false), error => {
      assert(error instanceof EnterpriseInvitationSessionError);
      assert.equal(error.reason, "account_mismatch");
      assert.equal(error.message, "请使用该邀请已验证的员工账号登录后重试。");
      assert.equal("terminal" in error, false, "a different login is not proof that the invitation is invalid");
      assert(!error.message.includes(invitedId) && !error.message.includes(anotherId));
      return true;
    });
  }
});

test("missing, empty or logout-blocked sessions demand login without an invitation-terminal error", () => {
  for (const session of [null, undefined, {}, { user: { id: invitedId } },
    { access_token: "", user: { id: invitedId } }, { access_token: " \t", user: { id: invitedId } }]) {
    assert.throws(() => requireEnterpriseInvitationSession(session, invitedId, false), error => {
      assert(error instanceof EnterpriseInvitationSessionError);
      assert.equal(error.reason, "session_missing");
      assert.equal("terminal" in error, false);
      return true;
    });
  }
  assert.throws(() => requireEnterpriseInvitationSession({ access_token: "old-token", user: { id: invitedId } }, invitedId, true),
    error => error instanceof EnterpriseInvitationSessionError && error.reason === "session_missing");
});

test("unbound invitations cannot silently adopt the newly logged-in account", () => {
  const session = { access_token: "synthetic-token", user: { id: invitedId } };
  for (const target of [null, "", anotherId]) {
    assert.throws(() => requireEnterpriseInvitationSession(session, target, false),
      error => error instanceof EnterpriseInvitationSessionError && error.reason === "account_mismatch");
  }
});

test("rejecting the wrong account does not prevent an explicit later login as the original invitee", () => {
  const invitation = Object.freeze({ authUserId: invitedId, invitationVersion: 7, invitationToken: "synthetic-invitation", stage: "accept_pending" });
  const original = { ...invitation };
  assert.throws(() => requireEnterpriseInvitationSession({ access_token: "B", user: { id: anotherId } }, invitation.authUserId, false));
  assert.equal(requireEnterpriseInvitationSession({ access_token: "A-new", user: { id: invitedId } }, invitation.authUserId, false), "A-new");
  assert.deepEqual(invitation, original);
});
