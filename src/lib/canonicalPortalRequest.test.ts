import assert from "node:assert/strict";
import test from "node:test";
import {
  isCanonicalPortalRequest,
  resolveCanonicalPortalHostname,
  resolvePublicRequestHostname,
} from "@/lib/canonicalPortalRequest";

function withPortalOrigin(value: string, run: () => void) {
  const previous = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
  process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = value;
  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
    } else {
      process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = previous;
    }
  }
}

test("canonical portal requests require the exact configured hostname", () => {
  withPortalOrigin("https://faolla.com", () => {
    assert.equal(resolveCanonicalPortalHostname(), "faolla.com");
    assert.equal(
      isCanonicalPortalRequest(new Request("https://faolla.com/api/auth/status")),
      true,
    );
    assert.equal(
      isCanonicalPortalRequest(
        new Request("https://merchant.faolla.com/api/auth/status"),
      ),
      false,
    );
    assert.equal(
      isCanonicalPortalRequest(new Request("https://www.faolla.com/api/auth/status")),
      false,
    );
  });
});

test("trusted proxy hostname is used instead of the internal request URL", () => {
  withPortalOrigin("https://faolla.com", () => {
    const request = new Request("http://127.0.0.1:3000/api/auth/status", {
      headers: {
        host: "127.0.0.1:3000",
        "x-forwarded-host": "faolla.com",
      },
    });
    assert.equal(resolvePublicRequestHostname(request), "faolla.com");
    assert.equal(isCanonicalPortalRequest(request), true);
  });
});

test("merchant subdomain proxy requests cannot impersonate the portal", () => {
  withPortalOrigin("https://faolla.com", () => {
    const request = new Request("http://127.0.0.1:3000/api/super-admin/data", {
      headers: {
        host: "127.0.0.1:3000",
        "x-forwarded-host": "merchant.faolla.com",
      },
    });
    assert.equal(isCanonicalPortalRequest(request), false);
  });
});

test("a public Host header cannot be overridden by a spoofed forwarded host", () => {
  withPortalOrigin("https://www.faolla.com", () => {
    const request = new Request("https://merchant.faolla.com/api/auth/status", {
      headers: {
        host: "merchant.faolla.com",
        "x-forwarded-host": "www.faolla.com",
      },
    });
    assert.equal(resolvePublicRequestHostname(request), "merchant.faolla.com");
    assert.equal(isCanonicalPortalRequest(request), false);
  });
});
