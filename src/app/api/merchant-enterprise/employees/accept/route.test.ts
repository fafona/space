import assert from "node:assert/strict";
import test from "node:test";
import { withAttendanceApplicationAuth } from "../../../../../../scripts/fixtures/attendance-application-auth";
import { MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY } from "@/lib/merchantStaffPrincipal.server";
import { POST } from "./route-handler";

test("current Auth password-initialized=false blocks actual acceptance before any recovery read or writer", async () => {
  const actor = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "invitation-metadata@example.test",
  };
  await withAttendanceApplicationAuth([actor], async () => {
    assert.fail("password setup gate must precede every invitation RPC");
  }, async auth => {
    const accessToken = await auth.login(actor);
    const fixtureFetch = globalThis.fetch;
    let currentUserReads = 0;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      // Delegate first: the closed fixture validates the real SDK's token and
      // account. Vary only the authoritative Auth metadata, not JWT claims.
      const response = await fixtureFetch(request);
      if (request.method !== "GET" || new URL(request.url).pathname !== "/auth/v1/user" || !response.ok) {
        return response;
      }
      currentUserReads += 1;
      const user = await response.json();
      return new Response(JSON.stringify({
        ...user,
        app_metadata: {
          ...user.app_metadata,
          [MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY]: false,
        },
      }), { status: response.status, headers: response.headers });
    };
    try {
      for (const credentials of [
        { invitationVersion: 7, invitationToken: "synthetic_invitation_credential_0123456789" },
        {},
      ]) {
        const response = await POST(new Request("https://www.faolla.com/api/merchant-enterprise/employees/accept", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://www.faolla.com",
            "sec-fetch-site": "same-origin",
            "x-merchant-access-token": accessToken,
          },
          body: JSON.stringify({ siteId: "99990001", ...credentials }),
        }));
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { ok: false, error: "employee_initial_password_setup_required" });
      }
      assert(currentUserReads >= 2, "both paths must validate current Auth user metadata");
      assert.equal(auth.calls.some(call => call.path.startsWith("/rest/")), false);
      assert(auth.calls.every(call => ["/auth/v1/token", "/auth/v1/user"].includes(call.path)));
    } finally {
      globalThis.fetch = fixtureFetch;
    }
  });
});
