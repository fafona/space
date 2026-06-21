#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION = "1.4.0";
const DEFAULT_PORT = 17658;
const DEFAULT_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 4 * 1024 * 1024;
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

function normalizeNumberRange(value, min, max, fallback, precision = 1) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  const clamped = Math.min(max, Math.max(min, numberValue));
  return Number(clamped.toFixed(precision));
}

function getTextBaseColumns(paperWidthMm) {
  return paperWidthMm >= 76 ? 48 : 32;
}

function getMarginTextLayout({ paperWidthMm = 58, contentMarginTopMm = 0, contentMarginBottomMm = 0, contentMarginLeftMm = 0 }) {
  const safePaperWidthMm = normalizeIntegerRange(paperWidthMm, 40, 120, 58);
  const baseColumns = getTextBaseColumns(safePaperWidthMm);
  const leftColumns = Math.max(0, Math.round((normalizeNumberRange(contentMarginLeftMm, 0, 20, 0) / safePaperWidthMm) * baseColumns));
  return {
    topLines: Math.max(0, Math.round(normalizeNumberRange(contentMarginTopMm, 0, 20, 0) / 4)),
    bottomLines: Math.max(0, Math.round(normalizeNumberRange(contentMarginBottomMm, 0, 20, 0) / 4)),
    leftPrefix: " ".repeat(Math.min(12, leftColumns)),
  };
}

function applyTextMargins(content, margins) {
  const layout = getMarginTextLayout(margins);
  const normalizedContent = String(content || "").slice(0, MAX_CONTENT_CHARS).replace(/\r?\n/g, "\n").trimEnd();
  const lines = normalizedContent.split("\n").map((line) => (line ? `${layout.leftPrefix}${line}` : line));
  return [
    ...Array.from({ length: layout.topLines }, () => ""),
    ...lines,
    ...Array.from({ length: layout.bottomLines }, () => ""),
  ].join("\n");
}

function normalizeCutMode(value) {
  return value === "full" ? "full" : "partial";
}

function normalizeUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.length > 1000) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function normalizeDataImage(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.length > 3_500_000) return "";
  return /^data:image\/(png|jpe?g|gif|bmp);base64,[a-z0-9+/=\s]+$/i.test(trimmed) ? trimmed : "";
}

function readSafeErrorMessage(error, fallback) {
  const raw = [error?.stderr, error?.stdout, error?.message]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n");
  if (!raw) return fallback;
  if (/default_printer_not_found/i.test(raw)) return "default_printer_not_found";
  if (/OpenPrinter failed/i.test(raw)) return "OpenPrinter failed";
  if (/StartDocPrinter failed/i.test(raw)) return "StartDocPrinter failed";
  if (/StartPagePrinter failed/i.test(raw)) return "StartPagePrinter failed";
  if (/WritePrinter failed/i.test(raw)) return "WritePrinter failed";
  if (/timeout|timed out|operation timed out/i.test(raw)) return "print_timeout";
  if (/request_too_large/i.test(raw)) return "request_too_large";
  if (/invalid_json/i.test(raw)) return "invalid_json";
  if (/EncodedCommand|Command failed: powershell\.exe/i.test(raw)) return fallback;
  const firstUsefulLine =
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/EncodedCommand|Command failed: powershell\.exe/i.test(line)) || "";
  return firstUsefulLine.slice(0, 200) || fallback;
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

async function printTextJob({
  content,
  printerName = "",
  jobName = "FAOLLA receipt",
  paperWidthMm = 58,
  contentMarginTopMm = 0,
  contentMarginBottomMm = 0,
  contentMarginLeftMm = 0,
}) {
  const normalizedContent = `${applyTextMargins(content, {
    paperWidthMm,
    contentMarginTopMm,
    contentMarginBottomMm,
    contentMarginLeftMm,
  })}\n`.replace(/\r?\n/g, "\r\n");
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
  cutPaperAfterPrint = true,
  paperWidthMm = 58,
  contentMarginTopMm = 0,
  contentMarginRightMm = 0,
  contentMarginBottomMm = 0,
  contentMarginLeftMm = 0,
  headerLogoUrl = "",
  headerLogoDataUrl = "",
  headerLogoWidthPercent = 42,
  receiptImageDataUrl = "",
}) {
  const normalizedContent = `${String(content || "")
    .slice(0, MAX_CONTENT_CHARS)
    .replace(/\r?\n/g, "\n")
    .trimEnd()}\n`;
  if (!normalizedContent.trim()) throw new Error("empty_print_content");
  const safeFeedLines = normalizeIntegerRange(feedLinesBeforeCut, 0, 10, 4);
  const safeCutMode = normalizeCutMode(cutPaperMode);
  const safePaperWidthMm = normalizeIntegerRange(paperWidthMm, 40, 120, 58);
  const safeContentMarginTopMm = normalizeNumberRange(contentMarginTopMm, 0, 20, 0);
  const safeContentMarginRightMm = normalizeNumberRange(contentMarginRightMm, 0, 20, 0);
  const safeContentMarginBottomMm = normalizeNumberRange(contentMarginBottomMm, 0, 20, 0);
  const safeContentMarginLeftMm = normalizeNumberRange(contentMarginLeftMm, 0, 20, 0);
  const safeHeaderLogoWidthPercent = normalizeIntegerRange(headerLogoWidthPercent, 20, 80, 42);
  const safeHeaderLogoUrl = normalizeUrl(headerLogoUrl);
  const safeHeaderLogoDataUrl = normalizeDataImage(headerLogoDataUrl);
  const safeReceiptImageDataUrl = normalizeDataImage(receiptImageDataUrl);
  const shouldCutPaper = Boolean(cutPaperAfterPrint);
  const workDir = path.join(tmpdir(), "faolla-print-helper");
  await mkdir(workDir, { recursive: true });
  const filePath = path.join(workDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  const logoDataPath = safeHeaderLogoDataUrl
    ? path.join(workDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-logo.txt`)
    : "";
  const receiptImageDataPath = safeReceiptImageDataUrl
    ? path.join(workDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-receipt-image.txt`)
    : "";
  await writeFile(filePath, normalizedContent, "utf8");
  if (logoDataPath) await writeFile(logoDataPath, safeHeaderLogoDataUrl, "utf8");
  if (receiptImageDataPath) await writeFile(receiptImageDataPath, safeReceiptImageDataUrl, "utf8");
  try {
    const stdout = await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
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
$cutPaperAfterPrint = ${shouldCutPaper ? "$true" : "$false"}
$paperWidthMm = ${safePaperWidthMm}
$contentMarginTopMm = ${safeContentMarginTopMm}
$contentMarginRightMm = ${safeContentMarginRightMm}
$contentMarginBottomMm = ${safeContentMarginBottomMm}
$contentMarginLeftMm = ${safeContentMarginLeftMm}
$headerLogoUrl = ${psString(safeHeaderLogoUrl)}
$headerLogoDataPath = ${psString(logoDataPath)}
$receiptImageDataPath = ${psString(receiptImageDataPath)}
$headerLogoDataUrl = if ($headerLogoDataPath -and (Test-Path -LiteralPath $headerLogoDataPath)) { Get-Content -LiteralPath $headerLogoDataPath -Raw -Encoding UTF8 } else { '' }
$receiptImageDataUrl = if ($receiptImageDataPath -and (Test-Path -LiteralPath $receiptImageDataPath)) { Get-Content -LiteralPath $receiptImageDataPath -Raw -Encoding UTF8 } else { '' }
$headerLogoWidthPercent = ${safeHeaderLogoWidthPercent}
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
function Add-ReceiptLogoBytes {
  param(
    [System.Collections.Generic.List[byte]] $TargetBytes,
    [string] $LogoUrl,
    [string] $LogoDataUrl,
    [int] $PaperWidthMm,
    [double] $ContentMarginRightMm,
    [double] $ContentMarginLeftMm,
    [int] $LogoWidthPercent
  )
  if (-not $LogoUrl -and -not $LogoDataUrl) { return }
  try {
    $null = Add-Type -AssemblyName System.Drawing
    $client = $null
    if ($LogoDataUrl -match '^data:image/[^;]+;base64,(.+)$') {
      $downloadedBytes = [Convert]::FromBase64String($matches[1])
    } else {
      [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
      $client = New-Object System.Net.WebClient
      $client.Headers.Add('User-Agent', 'FAOLLA Print Helper')
      $downloadedBytes = $client.DownloadData($LogoUrl)
    }
    $stream = New-Object System.IO.MemoryStream(,$downloadedBytes)
    $image = [System.Drawing.Image]::FromStream($stream)
    try {
      $paperDots = if ($PaperWidthMm -ge 76) { 576 } else { 384 }
      $dotsPerMm = $paperDots / [double]$PaperWidthMm
      $usableDots = [Math]::Max(128, $paperDots - [Math]::Round(([Math]::Max(0, $ContentMarginLeftMm) + [Math]::Max(0, $ContentMarginRightMm)) * $dotsPerMm))
      $targetWidth = [Math]::Round($usableDots * ([Math]::Max(20, [Math]::Min(80, $LogoWidthPercent)) / 100.0))
      $targetWidth = [Math]::Max(64, [Math]::Min($usableDots, $targetWidth))
      if (($targetWidth % 8) -ne 0) {
        $targetWidth = [Math]::Min($paperDots, [Math]::Ceiling($targetWidth / 8.0) * 8)
      }
      $scale = $targetWidth / [double]$image.Width
      $targetHeight = [Math]::Max(1, [Math]::Round($image.Height * $scale))
      $maxHeight = if ($PaperWidthMm -ge 76) { 240 } else { 180 }
      if ($targetHeight -gt $maxHeight) {
        $heightScale = $maxHeight / [double]$targetHeight
        $targetHeight = $maxHeight
        $targetWidth = [Math]::Max(64, [Math]::Round($targetWidth * $heightScale))
        if (($targetWidth % 8) -ne 0) {
          $targetWidth = [Math]::Ceiling($targetWidth / 8.0) * 8
        }
      }
      $bitmap = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $targetWidth, $targetHeight)
      } finally {
        $graphics.Dispose()
      }
      $widthBytes = [Math]::Ceiling($targetWidth / 8.0)
      $rasterBytes = New-Object 'System.Collections.Generic.List[byte]'
      for ($y = 0; $y -lt $targetHeight; $y++) {
        for ($byteX = 0; $byteX -lt $widthBytes; $byteX++) {
          $value = 0
          for ($bit = 0; $bit -lt 8; $bit++) {
            $x = ($byteX * 8) + $bit
            if ($x -lt $targetWidth) {
              $pixel = $bitmap.GetPixel($x, $y)
              $luminance = ($pixel.R * 0.299) + ($pixel.G * 0.587) + ($pixel.B * 0.114)
              if ($pixel.A -gt 30 -and $luminance -lt 190) {
                $value = $value -bor (0x80 -shr $bit)
              }
            }
          }
          $rasterBytes.Add([byte]$value)
        }
      }
      $xL = [byte]($widthBytes % 256)
      $xH = [byte]([Math]::Floor($widthBytes / 256))
      $yL = [byte]($targetHeight % 256)
      $yH = [byte]([Math]::Floor($targetHeight / 256))
      $TargetBytes.AddRange([byte[]](0x1B, 0x61, 0x01))
      $TargetBytes.AddRange([byte[]](0x1D, 0x76, 0x30, 0x00, $xL, $xH, $yL, $yH))
      $TargetBytes.AddRange($rasterBytes.ToArray())
      $TargetBytes.Add([byte]0x0A)
      $TargetBytes.AddRange([byte[]](0x1B, 0x61, 0x00))
      $bitmap.Dispose()
    } finally {
      $image.Dispose()
      $stream.Dispose()
      if ($client) { $client.Dispose() }
    }
  } catch {
    # Logo failures must not block receipt printing.
  }
}

function Add-ReceiptRasterImageBytes {
  param(
    [System.Collections.Generic.List[byte]] $TargetBytes,
    [string] $ImageDataUrl,
    [int] $PaperWidthMm
  )
  if (-not $ImageDataUrl) { return $false }
  try {
    $null = Add-Type -AssemblyName System.Drawing
    if ($ImageDataUrl -notmatch '^data:image/[^;]+;base64,(.+)$') { return $false }
    $downloadedBytes = [Convert]::FromBase64String($matches[1])
    $stream = New-Object System.IO.MemoryStream(,$downloadedBytes)
    $image = [System.Drawing.Image]::FromStream($stream)
    try {
      $paperDots = if ($PaperWidthMm -ge 76) { 576 } else { 384 }
      $targetWidth = $paperDots
      $scale = $targetWidth / [double]$image.Width
      $targetHeight = [Math]::Max(1, [Math]::Round($image.Height * $scale))
      $maxHeight = 8000
      if ($targetHeight -gt $maxHeight) {
        $heightScale = $maxHeight / [double]$targetHeight
        $targetHeight = $maxHeight
        $targetWidth = [Math]::Max(64, [Math]::Round($targetWidth * $heightScale))
        if (($targetWidth % 8) -ne 0) {
          $targetWidth = [Math]::Ceiling($targetWidth / 8.0) * 8
        }
      }
      $bitmap = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $targetWidth, $targetHeight)
      } finally {
        $graphics.Dispose()
      }
      $widthBytes = [Math]::Ceiling($targetWidth / 8.0)
      $rasterBytes = New-Object 'System.Collections.Generic.List[byte]'
      for ($y = 0; $y -lt $targetHeight; $y++) {
        for ($byteX = 0; $byteX -lt $widthBytes; $byteX++) {
          $value = 0
          for ($bit = 0; $bit -lt 8; $bit++) {
            $x = ($byteX * 8) + $bit
            if ($x -lt $targetWidth) {
              $pixel = $bitmap.GetPixel($x, $y)
              $luminance = ($pixel.R * 0.299) + ($pixel.G * 0.587) + ($pixel.B * 0.114)
              if ($pixel.A -gt 30 -and $luminance -lt 190) {
                $value = $value -bor (0x80 -shr $bit)
              }
            }
          }
          $rasterBytes.Add([byte]$value)
        }
      }
      $xL = [byte]($widthBytes % 256)
      $xH = [byte]([Math]::Floor($widthBytes / 256))
      $yL = [byte]($targetHeight % 256)
      $yH = [byte]([Math]::Floor($targetHeight / 256))
      $TargetBytes.AddRange([byte[]](0x1B, 0x61, 0x00))
      $TargetBytes.AddRange([byte[]](0x1D, 0x76, 0x30, 0x00, $xL, $xH, $yL, $yH))
      $TargetBytes.AddRange($rasterBytes.ToArray())
      $TargetBytes.Add([byte]0x0A)
      $bitmap.Dispose()
      return $true
    } finally {
      $image.Dispose()
      $stream.Dispose()
    }
  } catch {
    return $false
  }
}
$encoding = [System.Text.Encoding]::GetEncoding(936)
$textBytes = $encoding.GetBytes($content)
$bytes = New-Object 'System.Collections.Generic.List[byte]'
$bytes.AddRange([byte[]](0x1B, 0x40))
$paperDots = if ($paperWidthMm -ge 76) { 576 } else { 384 }
$dotsPerMm = $paperDots / [double]$paperWidthMm
$receiptImagePrinted = Add-ReceiptRasterImageBytes -TargetBytes $bytes -ImageDataUrl $receiptImageDataUrl -PaperWidthMm $paperWidthMm
if (-not $receiptImagePrinted) {
  $leftMarginDots = [Math]::Max(0, [Math]::Round($contentMarginLeftMm * $dotsPerMm))
  $rightMarginDots = [Math]::Max(0, [Math]::Round($contentMarginRightMm * $dotsPerMm))
  $printAreaDots = [Math]::Max(128, $paperDots - $leftMarginDots - $rightMarginDots)
  $leftMarginL = [byte]($leftMarginDots % 256)
  $leftMarginH = [byte]([Math]::Floor($leftMarginDots / 256))
  $printAreaL = [byte]($printAreaDots % 256)
  $printAreaH = [byte]([Math]::Floor($printAreaDots / 256))
  $topMarginLines = [Math]::Max(0, [Math]::Round($contentMarginTopMm / 4.0))
  $bottomMarginLines = [Math]::Max(0, [Math]::Round($contentMarginBottomMm / 4.0))
  $bytes.AddRange([byte[]](0x1D, 0x4C, $leftMarginL, $leftMarginH))
  $bytes.AddRange([byte[]](0x1D, 0x57, $printAreaL, $printAreaH))
  for ($i = 0; $i -lt $topMarginLines; $i++) {
    $bytes.Add([byte]0x0A)
  }
  $null = Add-ReceiptLogoBytes -TargetBytes $bytes -LogoUrl $headerLogoUrl -LogoDataUrl $headerLogoDataUrl -PaperWidthMm $paperWidthMm -ContentMarginRightMm $contentMarginRightMm -ContentMarginLeftMm $contentMarginLeftMm -LogoWidthPercent $headerLogoWidthPercent
  $bytes.AddRange($textBytes)
  for ($i = 0; $i -lt $bottomMarginLines; $i++) {
    $bytes.Add([byte]0x0A)
  }
}
if ($cutPaperAfterPrint) {
  for ($i = 0; $i -lt $feedLines; $i++) {
    $bytes.Add([byte]0x0A)
  }
  if ($cutMode -eq 'full') {
    $bytes.AddRange([byte[]](0x1D, 0x56, 0x41, 0x00))
  } else {
    $bytes.AddRange([byte[]](0x1D, 0x56, 0x42, 0x00))
  }
}
$rawBytes = $bytes.ToArray()
[FaollaRawPrinter]::SendBytesToPrinter($printerName, $jobName, $rawBytes)
@{ printerName = $printerName; bytes = $rawBytes.Length; mode = 'escpos'; feedLinesBeforeCut = $feedLines; cutPaperMode = $cutMode; cutPaperAfterPrint = $cutPaperAfterPrint; headerLogo = [bool]($headerLogoUrl -or $headerLogoDataUrl); receiptImage = [bool]$receiptImagePrinted } | ConvertTo-Json -Compress
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
      cutPaperAfterPrint: shouldCutPaper,
      contentMarginTopMm: safeContentMarginTopMm,
      contentMarginRightMm: safeContentMarginRightMm,
      contentMarginBottomMm: safeContentMarginBottomMm,
      contentMarginLeftMm: safeContentMarginLeftMm,
      headerLogo: Boolean(safeHeaderLogoUrl || safeHeaderLogoDataUrl),
      receiptImage: Boolean(result.receiptImage),
    };
  } finally {
    void rm(filePath, { force: true });
    if (logoDataPath) void rm(logoDataPath, { force: true });
    if (receiptImageDataPath) void rm(receiptImageDataPath, { force: true });
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
      payload.printMode === "escpos" ||
      payload.cutPaperAfterPrint === true ||
      payload.rawEscpos === true ||
      Boolean(normalizeDataImage(payload.receiptImageDataUrl)) ||
      Boolean(normalizeUrl(payload.headerLogoUrl)) ||
      Boolean(normalizeDataImage(payload.headerLogoDataUrl));
    const result = shouldUseEscPos
      ? await printEscPosJob({
          content: payload.content,
          printerName: payload.printerName,
          jobName: payload.jobName,
          feedLinesBeforeCut: payload.feedLinesBeforeCut,
          cutPaperMode: payload.cutPaperMode,
          cutPaperAfterPrint: payload.cutPaperAfterPrint === true,
          paperWidthMm: payload.paperWidthMm,
          contentMarginTopMm: payload.contentMarginTopMm,
          contentMarginRightMm: payload.contentMarginRightMm,
          contentMarginBottomMm: payload.contentMarginBottomMm,
          contentMarginLeftMm: payload.contentMarginLeftMm,
          headerLogoUrl: payload.headerLogoUrl,
          headerLogoDataUrl: payload.headerLogoDataUrl,
          headerLogoWidthPercent: payload.headerLogoWidthPercent,
          receiptImageDataUrl: payload.receiptImageDataUrl,
        })
      : await printTextJob({
          content: payload.content,
          printerName: payload.printerName,
          jobName: payload.jobName,
          paperWidthMm: payload.paperWidthMm,
          contentMarginTopMm: payload.contentMarginTopMm,
          contentMarginBottomMm: payload.contentMarginBottomMm,
          contentMarginLeftMm: payload.contentMarginLeftMm,
        });
    sendJson(response, 200, { ok: true, result }, origin);
  } catch (error) {
    sendJson(response, 500, { ok: false, message: readSafeErrorMessage(error, "print_failed") }, origin);
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
      sendJson(response, 500, { ok: false, message: readSafeErrorMessage(error, "printer_list_failed") }, origin);
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
