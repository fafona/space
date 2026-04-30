import { chromium } from "playwright";

const DEFAULT_BASE_URL = "https://www.faolla.com";
const baseUrl = normalizeBaseUrl(process.env.MOBILE_SHELL_CHECK_URL || DEFAULT_BASE_URL);

function normalizeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL));
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function buildUrl(pathname, searchParams) {
  const url = new URL(pathname, `${baseUrl}/`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

async function waitForClientRender(page, timeoutMs = 3200) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(timeoutMs);
}

async function waitForVisibleFlag(page) {
  await page.waitForFunction(
    () =>
      Array.from(document.images).some((node) => {
        if (!node.src.includes("flagcdn.com")) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }),
    null,
    { timeout: 30_000 },
  );
  return page.locator('img[src*="flagcdn.com"]').evaluateAll((nodes) =>
    nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }).length,
  );
}

async function waitForMockAvatarCount(page, expectedCount) {
  await page.waitForFunction(
    (expected) => {
      const buttons = Array.from(document.querySelectorAll("button"))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return {
            text: (node.textContent || "").trim(),
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
            y: rect.y,
          };
        })
        .filter((item) => item.visible && item.y < 120 && item.text === "AB");
      return buttons.length === expected;
    },
    expectedCount,
    { timeout: 30_000 },
  );
}

async function readVisibleTopButtons(page) {
  return page.locator("button").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return {
          aria: node.getAttribute("aria-label") || "",
          text: (node.textContent || "").trim(),
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      })
      .filter((item) => item.visible && item.rect.y < 120),
  );
}

function countMockAvatarButtons(buttons) {
  return buttons.filter((button) => button.text === "AB").length;
}

async function assertNoWorkspaceCtaInAccountPanel(page) {
  const avatarButton = page
    .locator("button")
    .filter({ hasText: /^AB$/ })
    .first();
  await avatarButton.click();
  await page.waitForTimeout(300);
  const panelCtas = await page.locator("a, button").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return {
          text: (node.textContent || "").trim(),
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
        };
      })
      .filter((item) => item.visible)
      .map((item) => item.text),
  );
  assert(
    !panelCtas.some((text) => text.includes("进入后台") || text.includes("进入个人中心")),
    "Expected the public account panel not to show a workspace entry CTA.",
    panelCtas,
  );
}

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

async function installSessionMocks(page) {
  await page.route("**/api/auth/merchant-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        accountType: "personal",
        accountId: "u-10001",
        merchantId: "",
        merchantIds: [],
        user: {
          id: "user-10001",
          email: "person@example.com",
          user_metadata: {
            displayName: "ABC",
          },
          app_metadata: {},
        },
      }),
    }),
  );

  await page.route("**/api/personal-profile", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        profile: {
          displayName: "ABC",
          avatarUrl: "",
        },
        businessCards: [],
        favoriteSites: [],
      }),
    });
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const mobilePageOptions = {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  };
  let page = await browser.newPage(mobilePageOptions);

  try {
    await page.goto(buildUrl("/"), { waitUntil: "domcontentloaded", timeout: 60_000 });
    const visibleFlags = await waitForVisibleFlag(page);
    assert(visibleFlags > 0, "Expected mobile portal to show the language switcher flag.");

    await page.close();
    page = await browser.newPage(mobilePageOptions);
    await installSessionMocks(page);

    await page.goto(buildUrl("/", { appShell: "faolla" }), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMockAvatarCount(page, 1);
    const appShellButtons = await readVisibleTopButtons(page);
    assert(
      countMockAvatarButtons(appShellButtons) === 1,
      "Expected the embedded Faolla shell home to show exactly one mocked avatar.",
      appShellButtons,
    );
    await assertNoWorkspaceCtaInAccountPanel(page);

    await page.close();
    page = await browser.newPage(mobilePageOptions);
    await installSessionMocks(page);

    await page.goto(
      buildUrl("/me", {
        section: "faolla",
        faollaUrl: buildUrl("/"),
      }),
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    await page.locator('iframe[title="Faolla"]').first().waitFor({ state: "attached", timeout: 30_000 });
    await waitForClientRender(page, 4200);
    const personalFaollaFrameCount = await page.locator('iframe[title="Faolla"]').count();
    const personalTopButtons = await readVisibleTopButtons(page);
    assert(personalFaollaFrameCount > 0, "Expected mobile personal center to render the Faolla iframe.");
    assert(
      countMockAvatarButtons(personalTopButtons) === 0,
      "Expected mobile personal Faolla parent shell not to render an extra avatar.",
      personalTopButtons,
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          checks: [
            "mobile-language-switcher",
            "single-app-shell-avatar",
            "no-extra-personal-shell-avatar",
            "no-public-account-workspace-cta",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
