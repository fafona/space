import test from "node:test";
import assert from "node:assert/strict";
import type { Block } from "@/data/homeBlocks";
import { POST } from "@/app/api/publish/route";
import { getInlinePublishPayloadViolation } from "@/lib/publishPayloadValidation";

test("rejects inline image publish payloads", () => {
  const blocks = [
    {
      id: "b1",
      type: "common",
      props: {
        bgImageUrl: "data:image/png;base64,abc",
      },
    },
  ] as Block[];

  assert.equal(getInlinePublishPayloadViolation(blocks), "发布请求包含未外链化资源（图片 1）");
});

test("rejects inline audio publish payloads", () => {
  const blocks = [
    {
      id: "b2",
      type: "music",
      props: {
        audioUrl: "data:audio/mp3;base64,abc",
      },
    },
  ] as Block[];

  assert.equal(getInlinePublishPayloadViolation(blocks), "发布请求包含未外链化资源（音频 1）");
});

test("allows external-url payloads", () => {
  const blocks = [
    {
      id: "b3",
      type: "gallery",
      props: {
        heading: "ok",
        images: [{ id: "img-1", url: "https://example.com/image.webp" }],
      },
    },
  ] as Block[];

  assert.equal(getInlinePublishPayloadViolation(blocks), null);
});

test("publish rejects merchant requests without an authorized session", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousNextServiceRole = process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await POST(
      new Request("http://localhost/api/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "merchant-unauthorized",
          payload: {
            blocks: [
              {
                id: "block-1",
                type: "common",
                props: { heading: "ok" },
              },
            ],
            updated_at: "2026-04-05T12:00:00.000Z",
          },
          merchantIds: ["10000001"],
          merchantSlug: "demo-shop",
          isPlatformEditor: false,
        }),
      }),
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "unauthorized",
      message: "褰撳墠浼氳瘽鏃犳潈鍙戝竷璇ュ晢鎴峰唴瀹广€?",
      requestId: "merchant-unauthorized",
    });
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }
    if (previousServiceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
    }
    if (previousNextServiceRole === undefined) {
      delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY = previousNextServiceRole;
    }
  }
});

test("publish rejects platform requests without a verified super-admin session", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousNextServiceRole = process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await POST(
      new Request("http://localhost/api/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "platform-unauthorized",
          payload: {
            blocks: [
              {
                id: "block-platform",
                type: "common",
                props: { heading: "portal" },
              },
            ],
            updated_at: "2026-04-05T12:00:00.000Z",
          },
          isPlatformEditor: true,
        }),
      }),
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "unauthorized",
      message: "褰撳墠浼氳瘽鏃犳潈鍙戝竷骞冲彴鍐呭銆?",
      requestId: "platform-unauthorized",
    });
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }
    if (previousServiceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
    }
    if (previousNextServiceRole === undefined) {
      delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY = previousNextServiceRole;
    }
  }
});
