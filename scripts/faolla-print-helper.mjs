#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION = "1.1.0";
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

function normalizeIntegerRange(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function normalizeCutMode(value) {
  return value === "full" ? "full" : "partial";
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

async function printEscPosJob({
  content,
  printerName = "",
  jobName = "FAOLLA receipt",
  feedLinesBeforeCut = 4,
  cutPaperMode = "partial",
}) {
  const normalizedContent = `${String(content || "")
    .slice(0, MAX_CONTENT_CHARS)
    .replace(/\r?\n/g, "\n")
    .trimEnd()}\n`;
  if (!normalizedContent.trim()) throw new Error("empty_print_content");
  const safeFeedLines = normalizeIntegerRange(feedLinesBeforeCut, 0, 10, 4);
  const safeCutMode = normalizeCutMode(cutPaperMode);
  const workDir = path.join(tmpdir(), "faolla-print-helper");
  await mkdir(workDir, { recursive: true });
  const filePath = path.join(workDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  await writeFile(filePath, normalizedContent, "utf8");
  try {
    const stdout = await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
$printerName = ${psString(printerName)}
if (-not $printerName) {
  $printerName = Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1 -ExpandProperty Name
}
if (-not $printerName) {
  throw 'default_printer_not_found'
}
$jobName = ${psString(jobName)}
$feedLines = ${safeFeedLines}
$cutMode = ${psString(safeCutMode)}
$content = Get-Content -LiteralPath ${psString(filePath)} -Raw -Encoding UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class FaollaRawPrinter
{
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA
  {
    [MarshalAs(UnmanagedType.LPStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)]
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void SendBytesToPrinter(string printerName, string docName, byte[] bytes)
  {
    IntPtr hPrinter = IntPtr.Zero;
    IntPtr unmanagedBytes = IntPtr.Zero;
    int written = 0;
    bool success = false;
    DOCINFOA docInfo = new DOCINFOA();
    docInfo.pDocName = docName;
    docInfo.pDataType = "RAW";
    try
    {
      unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
      Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
      if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "OpenPrinter failed");
      }
      if (!StartDocPrinter(hPrinter, 1, docInfo)) {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "StartDocPrinter failed");
      }
      try
      {
        if (!StartPagePrinter(hPrinter)) {
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "StartPagePrinter failed");
        }
        try
        {
          success = WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written);
        }
        finally
        {
          EndPagePrinter(hPrinter);
        }
      }
      finally
      {
        EndDocPrinter(hPrinter);
      }
    }
    finally
    {
      if (hPrinter != IntPtr.Zero) ClosePrinter(hPrinter);
      if (unmanagedBytes != IntPtr.Zero) Marshal.FreeCoTaskMem(unmanagedBytes);
    }
    if (!success || written != bytes.Length) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "WritePrinter failed");
    }
  }
}
'@
$encoding = [System.Text.Encoding]::GetEncoding(936)
$textBytes = $encoding.GetBytes($content)
$bytes = New-Object 'System.Collections.Generic.List[byte]'
$bytes.AddRange([byte[]](0x1B, 0x40))
$bytes.AddRange($textBytes)
for ($i = 0; $i -lt $feedLines; $i++) {
  $bytes.Add([byte]0x0A)
}
if ($cutMode -eq 'full') {
  $bytes.AddRange([byte[]](0x1D, 0x56, 0x41, 0x00))
} else {
  $bytes.AddRange([byte[]](0x1D, 0x56, 0x42, 0x00))
}
$rawBytes = $bytes.ToArray()
[FaollaRawPrinter]::SendBytesToPrinter($printerName, $jobName, $rawBytes)
@{ printerName = $printerName; bytes = $rawBytes.Length; mode = 'escpos'; feedLinesBeforeCut = $feedLines; cutPaperMode = $cutMode } | ConvertTo-Json -Compress
`,
      30000,
    );
    const result = stdout ? JSON.parse(stdout) : {};
    return {
      mode: "escpos",
      jobName,
      printerName: String(result.printerName || printerName || ""),
      bytes: Number(result.bytes || Buffer.byteLength(normalizedContent, "utf8")),
      feedLinesBeforeCut: safeFeedLines,
      cutPaperMode: safeCutMode,
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
    const shouldUseEscPos =
      payload.printMode === "escpos" || payload.cutPaperAfterPrint === true || payload.rawEscpos === true;
    const result = shouldUseEscPos
      ? await printEscPosJob({
          content: payload.content,
          printerName: payload.printerName,
          jobName: payload.jobName,
          feedLinesBeforeCut: payload.feedLinesBeforeCut,
          cutPaperMode: payload.cutPaperMode,
        })
      : await printTextJob({
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
