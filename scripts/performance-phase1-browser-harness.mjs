import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import ts from "typescript";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(repositoryRoot, "scripts/fixtures/performance-phase1-browser.tsx");
const componentPath = path.join(repositoryRoot, "src/components/admin/MerchantCustomerManager.tsx");
const outputRoot = path.join(repositoryRoot, ".qa-in-memory/performance-phase1");
const normalizePath = (value) => value.replaceAll("\\", "/");

function collectClassCandidates(source) {
  const sourceFile = ts.createSourceFile("fixture.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const candidates = new Set();
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      node.text.split(/\s+/).filter(Boolean).forEach((candidate) => candidates.add(candidate));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...candidates];
}

export async function buildHarnessAssets() {
  // write:false is deliberate: no .next build, worker bootstrap, env loading,
  // credential access or generated application files are involved.
  const bundled = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [fixturePath],
    outdir: outputRoot,
    bundle: true,
    write: false,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    metafile: true,
    jsx: "automatic",
    tsconfig: path.join(repositoryRoot, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    entryNames: "entry-[hash]",
    chunkNames: "chunk-[hash]",
    logLevel: "warning",
  });
  const outputEntries = Object.entries(bundled.metafile.outputs);
  const absoluteKey = (key) => normalizePath(path.resolve(repositoryRoot, key));
  const byAbsoluteKey = new Map(outputEntries.map(([key, value]) => [absoluteKey(key), { key, ...value }]));
  const entry = outputEntries.find(([, value]) => value.entryPoint && path.resolve(repositoryRoot, value.entryPoint) === fixturePath);
  if (!entry) throw new Error("qa_entry_output_missing");
  const initialKeys = new Set();
  const queue = [absoluteKey(entry[0])];
  while (queue.length) {
    const key = queue.shift();
    if (initialKeys.has(key)) continue;
    const output = byAbsoluteKey.get(key);
    if (!output) throw new Error(`qa_static_import_unresolved:${key}`);
    initialKeys.add(key);
    for (const imported of output.imports) {
      if (imported.external) throw new Error(`qa_external_import_forbidden:${imported.path}`);
      if (imported.kind !== "dynamic-import") queue.push(absoluteKey(imported.path));
    }
  }
  const containsWorkbook = (output) => Object.keys(output.inputs).some((input) => /(?:^|\/)node_modules\/xlsx\//.test(normalizePath(input)));
  if ([...initialKeys].some((key) => containsWorkbook(byAbsoluteKey.get(key)))) {
    throw new Error("qa_xlsx_in_initial_static_graph");
  }
  const assetUrl = (file) => `/assets/${normalizePath(path.relative(outputRoot, file))}`;
  const assets = new Map(bundled.outputFiles.map((file) => [assetUrl(file.path), file.contents]));
  const workbookPaths = outputEntries.filter(([, value]) => containsWorkbook(value)).map(([key]) => assetUrl(path.resolve(repositoryRoot, key)));
  if (!workbookPaths.length) throw new Error("qa_lazy_workbook_chunk_missing");
  const componentSource = await readFile(componentPath, "utf8");
  const fixtureSource = await readFile(fixturePath, "utf8");
  const tailwind = await compile('@import "tailwindcss";', { base: repositoryRoot, onDependency: () => {} });
  // Use the installed real Tailwind version for the component's exact utility
  // classes/breakpoint; only the isolated test toolbar has additional CSS.
  const css = tailwind.build(collectClassCandidates(`${componentSource}\n${fixtureSource}`)) + `
body { margin: 0; background: #f1f5f9; color: #0f172a; font-family: Arial, sans-serif; }
.qa-toolbar { position: relative; z-index: 20000; padding: 14px 20px; background: #fff7ed; border-bottom: 1px solid #fdba74; }
.qa-toolbar > p { margin: 6px 0; font-size: 13px; }
.qa-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.qa-actions button, .qa-actions a { border: 1px solid #cbd5e1; border-radius: 6px; background: white; padding: 6px 10px; font-size: 13px; cursor: pointer; }
.qa-main { padding: 0 20px; }
.qa-toasts p { padding: 6px 0; font-weight: bold; }
.qa-toolbar pre { max-height: 220px; overflow: auto; font-size: 12px; }
@media (max-width: 639px) { .qa-main { padding: 0 8px; } }
`;
  const entryUrl = assetUrl(path.resolve(repositoryRoot, entry[0]));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FAOLLA isolated customer QA</title><link rel="stylesheet" href="/assets/harness.css"></head><body><div id="qa-root"></div><script type="module" src="${entryUrl}"></script></body></html>`;
  return {
    assets, css, html, workbookPaths,
    report: {
      isolated: true,
      initialStaticAssets: [...initialKeys].map((key) => assetUrl(key)),
      initialIncludesXlsx: false,
      workbookAssets: workbookPaths,
      css: "Installed Tailwind utilities; isolated toolbar, not full production shell",
    },
  };
}

function customersFor(siteId) {
  return Array.from({ length: 36 }, (_, index) => ({
    id: `${siteId}-customer-${index + 1}`, siteId,
    referenceCode: `QA-${String(index + 1).padStart(3, "0")}`, memberNo: "", accountId: "", authUserId: "", guestHash: "",
    displayName: `${siteId.endsWith("a") ? "A" : "B"} 模拟客户 ${index + 1}`,
    phone: "+00 000 000 000", email: `synthetic-${index + 1}@example.test`, birthday: "", gender: "",
    address: { country: "QA", province: "Synthetic", city: "Test City", postalCode: "00000", line1: "Not a real customer address", line2: "" },
    tax: { name: "", number: "QA-NOT-REAL", country: "", province: "", city: "", address: "" },
    allergens: [], tags: index % 3 === 0 ? ["模拟 VIP"] : [], notes: "Synthetic fixture only", customFields: {}, identityAliases: [],
    sources: index % 2 === 0 ? ["order"] : ["booking"], status: "active", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z",
    activity: { orderCount: index % 2 === 0 ? index + 1 : 0, bookingCount: index % 2, firstActivityAt: "2026-09-01T10:00:00.000Z", lastActivityAt: "2026-09-01T10:00:00.000Z", lastOrderAt: null, lastBookingAt: null, lastOrderNote: "", lastBookingNote: "", orderTotals: [{ label: "EUR", amount: 10 }] },
    incomplete: false,
  }));
}

export async function startHarness({ port = 3119, workbookDelayMs = 0 } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("qa_port_invalid");
  if (!Number.isInteger(workbookDelayMs) || workbookDelayMs < 0 || workbookDelayMs > 10_000) throw new Error("qa_delay_invalid");
  const bundle = await buildHarnessAssets();
  const requests = [];
  let pageWorkbookDelayMs = workbookDelayMs;
  const server = createServer(async (request, response) => {
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host)) {
      response.writeHead(403).end("qa_host_denied");
      return;
    }
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    requests.push({ method: request.method, path: url.pathname });
    if (requests.length > 100) requests.shift();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const send = (status, type, body) => response.writeHead(status, { "Content-Type": type }).end(body);
    if (request.method !== "GET") {
      send(403, "application/json; charset=utf-8", JSON.stringify({ error: "qa_read_only", message: "隔离测试：保存与确认导入不执行，未连接真实后台" }));
    } else if (url.pathname === "/") {
      // The dedicated local QA page controls its next lazy chunk. Module
      // requests can use the importing script rather than document as referrer.
      pageWorkbookDelayMs = url.searchParams.get("slowWorkbook") === "1" ? Math.max(3_000, workbookDelayMs) : workbookDelayMs;
      requests.splice(0, requests.length - 1);
      send(200, "text/html; charset=utf-8", bundle.html);
    } else if (url.pathname === "/assets/harness.css") {
      send(200, "text/css; charset=utf-8", bundle.css);
    } else if (bundle.assets.has(url.pathname)) {
      if (bundle.workbookPaths.includes(url.pathname)) {
        const delay = pageWorkbookDelayMs;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (!response.destroyed) send(200, "text/javascript; charset=utf-8", bundle.assets.get(url.pathname));
    } else if (url.pathname === "/api/merchant-customers") {
      const siteId = url.searchParams.get("siteId");
      if (!["qa-merchant-a", "qa-merchant-b"].includes(siteId)) send(400, "application/json", JSON.stringify({ error: "qa_site_required" }));
      else send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, customers: customersFor(siteId), version: "qa-v1", warnings: [] }));
    } else if (url.pathname === "/__qa/report") {
      send(200, "application/json; charset=utf-8", JSON.stringify({ ...bundle.report, pageWorkbookDelayMs, requests, workbookRequests: requests.filter((item) => bundle.workbookPaths.includes(item.path)).length }));
    } else if (url.pathname === "/__qa/customers.csv") {
      response.setHeader("Content-Disposition", 'attachment; filename="qa-customers.csv"');
      send(200, "text/csv; charset=utf-8", '\uFEFF客户名称,邮箱,备注\r\nSynthetic import,synthetic-import@example.test,QA fixture only\r\n');
    } else {
      send(404, "text/plain; charset=utf-8", "qa_endpoint_denied");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.log(JSON.stringify({ url: `http://127.0.0.1:${port}`, ...bundle.report, workbookDelayMs }));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = { port: 3119, workbookDelayMs: 0 };
  let checkOnly = false;
  for (const argument of process.argv.slice(2)) {
    if (argument === "--check") { checkOnly = true; continue; }
    const match = /^(--port|--workbook-delay-ms)=(\d+)$/.exec(argument);
    if (!match) throw new Error(`qa_argument_invalid:${argument}`);
    options[match[1] === "--port" ? "port" : "workbookDelayMs"] = Number(match[2]);
  }
  if (checkOnly) console.log(JSON.stringify((await buildHarnessAssets()).report));
  else {
    const server = await startHarness(options);
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
      server.closeAllConnections();
      server.close();
    });
  }
}
