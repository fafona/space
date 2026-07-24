import { pathToFileURL } from "node:url";

const DEFAULT_ORIGIN = "https://faolla.com";
const DEFAULT_PATHS = ["/", "/login", "/10909094"];
const DEFAULT_ATTEMPTS = 8;
const DEFAULT_DELAY_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_DYNAMIC_CHUNK_LIMIT = 96;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function normalizeProductionOrigin(value) {
  const parsed = new URL(String(value || DEFAULT_ORIGIN).trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`unsupported production smoke protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("production smoke origin must not contain credentials");
  }
  return parsed.origin;
}

export function normalizeProductionSmokePaths(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,\n]/)
        .map((entry) => entry.trim());
  const normalized = [];
  for (const rawEntry of entries) {
    const entry = String(rawEntry || "").trim();
    if (!entry) continue;
    if (!entry.startsWith("/") || entry.startsWith("//")) {
      throw new Error(`production smoke path must be root-relative: ${entry}`);
    }
    const parsed = new URL(entry, "https://faolla-smoke.invalid");
    const normalizedEntry = `${parsed.pathname}${parsed.search}`;
    if (!normalized.includes(normalizedEntry)) normalized.push(normalizedEntry);
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_PATHS];
}

export function collectNextStaticAssetUrls(html, pageUrl) {
  const page = new URL(pageUrl);
  const assets = new Set();
  const tags = String(html || "").match(/<(?:script|link)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attribute = tag.match(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawValue = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? "";
    if (!rawValue) continue;
    try {
      const asset = new URL(decodeHtmlAttribute(rawValue), page);
      if (asset.origin !== page.origin || !asset.pathname.startsWith("/_next/static/")) continue;
      assets.add(asset.href);
    } catch {
      // Ignore malformed non-critical tags; missing Next assets are caught by the minimum count.
    }
  }
  return [...assets];
}

export function collectNextStaticChunkDependencyUrls(source, assetUrl) {
  const asset = new URL(assetUrl);
  const dependencies = new Set();
  const references =
    String(source || "").match(
      /(?<![A-Za-z0-9:/.])(?:\/?_next\/)?static\/chunks\/[A-Za-z0-9][A-Za-z0-9._/-]*\.js(?:\?[A-Za-z0-9._~!$&'()*+,;=:@/?%-]*)?/g,
    ) ?? [];
  for (const reference of references) {
    if (reference.includes("..")) continue;
    const normalizedReference = reference
      .replace(/^\/?_next\//, "")
      .replace(/^\/+/, "");
    try {
      const dependency = new URL(`/_next/${normalizedReference}`, asset.origin);
      if (
        dependency.origin !== asset.origin ||
        !dependency.pathname.startsWith("/_next/static/chunks/") ||
        !dependency.pathname.endsWith(".js") ||
        dependency.href === asset.href
      ) {
        continue;
      }
      dependencies.add(dependency.href);
    } catch {
      // Ignore malformed strings that merely resemble a compiled chunk reference.
    }
  }
  return [...dependencies];
}

export function containsDefaultClientExceptionPage(html) {
  const visibleMarkup = String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlAttribute(visibleMarkup).includes(
    "Application error: a client-side exception has occurred",
  );
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": "Faolla-Production-Smoke/1.0",
        ...(options?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(values, concurrency, task) {
  const pending = [...values];
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, pending.length)) },
    async () => {
      while (pending.length > 0) {
        const value = pending.shift();
        if (value !== undefined) await task(value);
      }
    },
  );
  await Promise.all(workers);
}

function addSmokeNonce(url, nonce) {
  const parsed = new URL(url);
  parsed.searchParams.set("__faollaSmoke", nonce);
  return parsed.href;
}

async function assertSuccessfulResponse(url, response, label) {
  if (response.ok) return;
  await response.body?.cancel().catch(() => undefined);
  throw new Error(`${label} request failed (${response.status}): ${url}`);
}

async function runProductionSmokeAttempt({
  origin,
  paths,
  expectedBuildId,
  timeoutMs,
  concurrency,
  dynamicChunkLimit,
  nonce,
}) {
  const versionUrl = addSmokeNonce(new URL("/api/app-web-version", origin).href, nonce);
  const versionResponse = await fetchWithTimeout(versionUrl, { redirect: "follow" }, timeoutMs);
  await assertSuccessfulResponse(versionUrl, versionResponse, "version");
  const versionPayload = await versionResponse.json();
  const observedBuildId = String(versionPayload?.buildId || "").trim();
  if (!observedBuildId) {
    throw new Error("production version response did not include a buildId");
  }
  if (expectedBuildId && observedBuildId !== expectedBuildId) {
    throw new Error(`production build mismatch: expected ${expectedBuildId}, received ${observedBuildId}`);
  }

  const assets = new Set();
  const checkedPages = [];
  for (const path of paths) {
    const pageUrl = addSmokeNonce(new URL(path, origin).href, nonce);
    const response = await fetchWithTimeout(pageUrl, { redirect: "follow" }, timeoutMs);
    await assertSuccessfulResponse(pageUrl, response, "page");
    const html = await response.text();
    if (containsDefaultClientExceptionPage(html)) {
      throw new Error(`default client exception page detected: ${pageUrl}`);
    }
    const pageAssets = collectNextStaticAssetUrls(html, response.url || pageUrl);
    if (pageAssets.length === 0) {
      throw new Error(`page did not expose any Next.js static assets: ${pageUrl}`);
    }
    pageAssets.forEach((asset) => assets.add(asset));
    checkedPages.push({ requestedUrl: pageUrl, finalUrl: response.url || pageUrl, assets: pageAssets.length });
  }

  const directAssets = [...assets];
  const dynamicChunkDependencies = new Set();
  await mapWithConcurrency(directAssets, concurrency, async (assetUrl) => {
    const response = await fetchWithTimeout(assetUrl, { redirect: "follow" }, timeoutMs);
    await assertSuccessfulResponse(assetUrl, response, "static asset");
    const asset = new URL(assetUrl);
    if (asset.pathname.startsWith("/_next/static/chunks/") && asset.pathname.endsWith(".js")) {
      const source = await response.text();
      for (const dependencyUrl of collectNextStaticChunkDependencyUrls(source, assetUrl)) {
        if (!assets.has(dependencyUrl)) dynamicChunkDependencies.add(dependencyUrl);
      }
      return;
    }
    await response.body?.cancel().catch(() => undefined);
  });

  const discoveredDynamicChunks = [...dynamicChunkDependencies];
  if (discoveredDynamicChunks.length > dynamicChunkLimit) {
    throw new Error(
      `first-level dynamic chunk count exceeded safety limit: ${discoveredDynamicChunks.length} > ${dynamicChunkLimit}`,
    );
  }
  await mapWithConcurrency(discoveredDynamicChunks, concurrency, async (assetUrl) => {
    const response = await fetchWithTimeout(assetUrl, { redirect: "follow" }, timeoutMs);
    await assertSuccessfulResponse(assetUrl, response, "dynamic static asset");
    await response.arrayBuffer();
  });

  const serviceWorkerUrl = new URL("/faolla-sw.js", origin);
  serviceWorkerUrl.searchParams.set("build", observedBuildId.slice(0, 12));
  serviceWorkerUrl.searchParams.set("__faollaSmoke", nonce);
  const serviceWorkerResponse = await fetchWithTimeout(serviceWorkerUrl, { redirect: "follow" }, timeoutMs);
  await assertSuccessfulResponse(serviceWorkerUrl.href, serviceWorkerResponse, "service worker");
  await serviceWorkerResponse.body?.cancel().catch(() => undefined);

  return {
    ok: true,
    buildId: observedBuildId,
    pagesChecked: checkedPages.length,
    assetsChecked: assets.size + discoveredDynamicChunks.length,
    directAssetsChecked: assets.size,
    dynamicAssetsChecked: discoveredDynamicChunks.length,
    checkedPages,
  };
}

export async function runProductionSmoke(options = {}) {
  const origin = normalizeProductionOrigin(options.origin || DEFAULT_ORIGIN);
  const paths = normalizeProductionSmokePaths(options.paths || DEFAULT_PATHS);
  const expectedBuildId = String(options.expectedBuildId || "").trim();
  const attempts = Math.max(1, Number.parseInt(String(options.attempts ?? DEFAULT_ATTEMPTS), 10) || DEFAULT_ATTEMPTS);
  const delayMs = Math.max(0, Number.parseInt(String(options.delayMs ?? DEFAULT_DELAY_MS), 10) || 0);
  const timeoutMs = Math.max(250, Number.parseInt(String(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS);
  const concurrency = Math.max(
    1,
    Number.parseInt(String(options.concurrency ?? DEFAULT_CONCURRENCY), 10) || DEFAULT_CONCURRENCY,
  );
  const dynamicChunkLimit = Math.max(
    1,
    Number.parseInt(String(options.dynamicChunkLimit ?? DEFAULT_DYNAMIC_CHUNK_LIMIT), 10) ||
      DEFAULT_DYNAMIC_CHUNK_LIMIT,
  );
  const logger = options.logger ?? console;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const nonce = `${Date.now()}-${attempt}`;
    try {
      logger.log(`[production-smoke] attempt ${attempt}/${attempts}: ${origin}`);
      const result = await runProductionSmokeAttempt({
        origin,
        paths,
        expectedBuildId,
        timeoutMs,
        concurrency,
        dynamicChunkLimit,
        nonce,
      });
      logger.log(
        `[production-smoke] OK build=${result.buildId} pages=${result.pagesChecked} ` +
          `assets=${result.assetsChecked} dynamic=${result.dynamicAssetsChecked}`,
      );
      return result;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[production-smoke] attempt ${attempt} failed: ${message}`);
      if (attempt < attempts) await delay(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("production smoke check failed");
}

function readArgument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((entry) => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
  const result = await runProductionSmoke({
    origin: readArgument("origin") || process.env.FAOLLA_PRODUCTION_ORIGIN || DEFAULT_ORIGIN,
    paths: readArgument("paths") || process.env.FAOLLA_PRODUCTION_SMOKE_PATHS || DEFAULT_PATHS,
    expectedBuildId: readArgument("expected-build") || process.env.FAOLLA_WEB_BUILD_ID || "",
    attempts: readArgument("attempts") || process.env.FAOLLA_PRODUCTION_SMOKE_ATTEMPTS || DEFAULT_ATTEMPTS,
    delayMs: readArgument("delay-ms") || process.env.FAOLLA_PRODUCTION_SMOKE_DELAY_MS || DEFAULT_DELAY_MS,
    timeoutMs: readArgument("timeout-ms") || process.env.FAOLLA_PRODUCTION_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
    dynamicChunkLimit:
      readArgument("dynamic-chunk-limit") ||
      process.env.FAOLLA_PRODUCTION_SMOKE_DYNAMIC_CHUNK_LIMIT ||
      DEFAULT_DYNAMIC_CHUNK_LIMIT,
  });
  console.log(JSON.stringify(result));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`[production-smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
