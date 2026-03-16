import assert from "node:assert/strict";
import test from "node:test";
import { isMobileViewportRequest } from "@/lib/deviceViewport";

function createHeaders(values: Record<string, string>) {
  const entries = new Map(Object.entries(values));
  return {
    get(name: string) {
      return entries.get(name) ?? entries.get(name.toLowerCase()) ?? null;
    },
  };
}

test("isMobileViewportRequest prefers client hints for mobile requests", () => {
  assert.equal(
    isMobileViewportRequest(
      createHeaders({
        "sec-ch-ua-mobile": "?1",
      }),
    ),
    true,
  );
});

test("isMobileViewportRequest falls back to viewport width when provided", () => {
  assert.equal(
    isMobileViewportRequest(
      createHeaders({
        "viewport-width": "390",
      }),
    ),
    true,
  );
  assert.equal(
    isMobileViewportRequest(
      createHeaders({
        "viewport-width": "1280",
      }),
    ),
    false,
  );
});

test("isMobileViewportRequest falls back to mobile user agent detection", () => {
  assert.equal(
    isMobileViewportRequest(
      createHeaders({
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      }),
    ),
    true,
  );
  assert.equal(
    isMobileViewportRequest(
      createHeaders({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      }),
    ),
    false,
  );
});
