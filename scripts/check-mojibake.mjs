import fs from "node:fs";
import path from "node:path";

const strict = process.argv.includes("--strict");
const rootDir = path.resolve(process.cwd(), "src");
const supportedExt = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".md"]);
const suspiciousTokens = [
  "锛?",
  "銆?",
  "鍥剧墖",
  "闊抽",
  "鍙戝竷浣撴",
  "鏈€杩戝け璐",
  "杈撳叆",
  "涓婁紶",
  "鏆傛棤",
  "鎾斁鍣",
  "璇烽€夋嫨",
  "鍖哄潡",
  "鑱旂郴鏂瑰紡",
];

function walk(dir, collector) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(fullPath, collector);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (supportedExt.has(ext)) collector.push(fullPath);
  }
}

function checkFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const issues = [];
  lines.forEach((line, index) => {
    if (line.includes("�")) {
      issues.push({ filePath, line: index + 1, reason: "contains replacement character", sample: line.trim() });
      return;
    }
    const token = suspiciousTokens.find((item) => line.includes(item));
    if (token) {
      issues.push({ filePath, line: index + 1, reason: `contains suspicious token: ${token}`, sample: line.trim() });
    }
  });
  return issues;
}

if (!fs.existsSync(rootDir)) {
  console.log("skip: src directory not found");
  process.exit(0);
}

const files = [];
walk(rootDir, files);

const issues = [];
for (const filePath of files) {
  issues.push(...checkFile(filePath));
}

if (issues.length === 0) {
  console.log("encoding-check: no suspicious mojibake detected");
  process.exit(0);
}

console.log(`encoding-check: found ${issues.length} suspicious lines`);
for (const issue of issues.slice(0, 200)) {
  const rel = path.relative(process.cwd(), issue.filePath);
  console.log(`- ${rel}:${issue.line} ${issue.reason}`);
}
if (issues.length > 200) {
  console.log(`... ${issues.length - 200} more lines omitted`);
}

if (strict) {
  process.exit(1);
}
