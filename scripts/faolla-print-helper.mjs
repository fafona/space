#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION = "1.0.0";
const DEFAULT_PORT = 17658;
const DEFAULT_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_CONTENT_CHARS = 120_000;

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.join("=") || "1"];
    })
    .filter(([key]) => key),
);

const host = args.get("host") || process.env.FAOLLA_PRINT_HELPER_HOST || DEFAULT_HOST;
const port = Number(args.get("port") || process.env.FAOLLA_PRINT_HELPER_PORT || DEFAULT_PORT);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?faolla\.com$/i.test(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin)) return true;
  const extra = String(process.env.FAOLLA_PRINT_HELPER_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

function sendJson(response, statusCode, payload, origin = "") {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
  response.end(JSON.stringify(payload));
}

function handleOptions(request, response) {
  const origin = request.headers.origin || "";
  if (!isAllowedOrigin(origin)) {
    sendJson(response, 403, { ok: false, message: "origin_not_allowed" });
    return;
  }
  response.statusCode = 204;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,accept");
  response.setHeader("access-control-max-age", "86400");
  response.setHeader("vary", "origin");
  response.end();
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function runPowerShell(script, timeout = 15000) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout.trim();
}

function psString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

async function listPrinters() {
  const stdout = await runPowerShell(`
$ErrorActionPreference = 'Stop'
$printers = Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName, Default, PrinterStatus
$printers | ConvertTo-Json -Depth 3
`);
  if (!stdout) return [];
  const parsed = JSON.parse(stdout);
  const printers = Array.isArray(parsed) ? parsed : [parsed];
  return printers.map((printer) => ({
    name: String(printer.Name || ""),
    driverName: String(printer.DriverName || ""),
    portName: String(printer.PortName || ""),
    isDefault: Boolean(printer.Default),
    status: String(printer.PrinterStatus || ""),
  }));
}

async function printTextJob({ content, printerName = "", jobName = "FAOLLA receipt" }) {
  const normalizedContent = String(content || "").slice(0, MAX_CONTENT_CHARS).replace(/\r?\n/g, "\r\n");
  if (!normalizedContent.trim()) throw new Error("empty_print_content");
  const workDir = path.join(tmpdir(), "faolla-print-helper");
  await mkdir(workDir, { recursive: true });
  const filePath = path.join(workDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  await writeFile(filePath, normalizedContent, "utf8");
  try {
    await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
$content = Get-Content -LiteralPath ${psString(filePath)} -Raw -Encoding UTF8
$printerName = ${psString(printerName)}
if ($printerName) {
  $content | Out-Printer -Name $printerName
} else {
  $content | Out-Printer
}
`,
      30000,
    );
    return {
      jobName,
      printerName: printerName || "",
      bytes: Buffer.byteLength(normalizedContent, "utf8"),
    };
  } finally {
    void rm(filePath, { force: true });
  }
}

async function handlePrint(request, response) {
  const origin = request.headers.origin || "";
  if (!isAllowedOrigin(origin)) {
    sendJson(response, 403, { ok: false, message: "origin_not_allowed" }, origin);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error instanceof Error ? error.message : "invalid_json" }, origin);
    return;
  }
  if (payload?.source !== "faolla-web") {
    sendJson(response, 400, { ok: false, message: "invalid_source" }, origin);
    return;
  }
  try {
    const result = await printTextJob({
      content: payload.content,
      printerName: payload.printerName,
      jobName: payload.jobName,
    });
    sendJson(response, 200, { ok: true, result }, origin);
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error instanceof Error ? error.message : "print_failed" }, origin);
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (request.method === "OPTIONS") {
    handleOptions(request, response);
    return;
  }
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (url.pathname === "/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, name: "faolla-print-helper", version: VERSION }, origin);
    return;
  }
  if (url.pathname === "/printers" && request.method === "GET") {
    if (!isAllowedOrigin(origin)) {
      sendJson(response, 403, { ok: false, message: "origin_not_allowed" }, origin);
      return;
    }
    try {
      sendJson(response, 200, { ok: true, printers: await listPrinters() }, origin);
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error instanceof Error ? error.message : "printer_list_failed" }, origin);
    }
    return;
  }
  if (url.pathname === "/print" && request.method === "POST") {
    await handlePrint(request, response);
    return;
  }
  sendJson(response, 404, {
    ok: false,
    message: "not_found",
    routes: ["/health", "/printers", "/print"],
  }, origin);
});

server.listen(port, host, () => {
  console.log(`FAOLLA print helper ${VERSION} listening on http://${host}:${port}`);
  console.log("Press Ctrl+C to stop.");
});
