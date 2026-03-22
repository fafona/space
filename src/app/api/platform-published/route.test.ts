import test from "node:test";
import assert from "node:assert/strict";
import {
  GET,
  isMissingPlatformMerchantIdColumn,
  isMissingPlatformSlugColumn,
} from "@/app/api/platform-published/route";

test("platform-published schema helpers detect known missing-column errors", () => {
  assert.equal(isMissingPlatformSlugColumn('column pages.slug does not exist'), true);
  assert.equal(
    isMissingPlatformSlugColumn('could not find the "slug" column of "pages" in the schema cache'),
    true,
  );
  assert.equal(isMissingPlatformSlugColumn("other failure"), false);

  assert.equal(isMissingPlatformMerchantIdColumn('column pages.merchant_id does not exist'), true);
  assert.equal(
    isMissingPlatformMerchantIdColumn('could not find the "merchant_id" column of "pages" in the schema cache'),
    true,
  );
  assert.equal(isMissingPlatformMerchantIdColumn("other failure"), false);
});

test("platform-published returns a structured error when server env is missing", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousNextServiceRole = process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  try {
    const response = await GET();
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "platform_published_env_missing" });
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
    process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY = previousNextServiceRole;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
  }
});
