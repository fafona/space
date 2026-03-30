import fs from "node:fs";
import path from "node:path";

const strict = process.argv.includes("--strict");
const rootDirs = [
  path.resolve(process.cwd(), "src"),
  path.resolve(process.cwd(), "scripts"),
];
const supportedExt = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".md"]);
const suspiciousPatterns = [
  /请先选中丌/,
  /正在重压当前页图\.\./,
  /重压完成\{stats\.changed\}/,
  /正在外链化大\.\./,
  /外链化失败，请查存储配/,
  /草已保/,
  /^\s*["']发布\.\.["'](?=\s*[:),}])/,
  /无变更，已跳过发(?=["'}\s])/,
];

function walk(dir, collector) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
      walk(fullPath, collector);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (supportedExt.has(ext)) collector.push(fullPath);
  }
}

function checkFile(filePath) {
  if (path.basename(filePath) === "check-mojibake.mjs") return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const issues = [];
  lines.forEach((line, index) => {
    if (line.includes("\uFFFD")) {
      issues.push({ filePath, line: index + 1, reason: "contains replacement character", sample: line.trim() });
      return;
    }
    if (/[\uE000-\uF8FF]/.test(line)) {
      issues.push({ filePath, line: index + 1, reason: "contains private-use unicode characters", sample: line.trim() });
      return;
    }
    const pattern = suspiciousPatterns.find((item) => item.test(line));
    if (pattern) {
      issues.push({ filePath, line: index + 1, reason: `contains suspicious pattern: ${pattern}`, sample: line.trim() });
    }
  });
  return issues;
}

if (!rootDirs.some((dir) => fs.existsSync(dir))) {
  console.log("skip: source directories not found");
  process.exit(0);
}

const files = [];
rootDirs.forEach((dir) => walk(dir, files));

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
