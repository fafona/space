import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, "src");
const OUTPUT_PATH = path.join(ROOT_DIR, "src", "lib", "domTranslations.generated.json");
const CACHE_PATH = path.join(ROOT_DIR, "logs", "dom-translation-cache.json");
const TARGET_LANGS = ["zh-TW", "ja", "ko", "en"];
const MAX_TEXT_LENGTH = 140;
const CONCURRENCY = 8;
const SKIP_FILE_PATTERNS = [
  /(?:^|[\\/])editorSystemDefaults\.ts$/,
  /\.test\.(?:ts|tsx)$/,
];

function walkFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(next, out);
      return;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) return;
    if (entry.name.endsWith(".generated.ts")) return;
    const normalizedPath = next.replace(/\\/g, "/");
    if (SKIP_FILE_PATTERNS.some((pattern) => pattern.test(normalizedPath))) return;
    out.push(next);
  });
  return out;
}

function looksLikeHumanSentence(value) {
  if (!/[\u3400-\u9fff]/.test(value)) return false;
  if (value.length > MAX_TEXT_LENGTH) return false;
  if (/[`{}[\]$]/.test(value)) return false;
  if (/=>|import\s|export\s|function\s|const\s|return\s|className|onClick|window\.|document\./i.test(value)) {
    return false;
  }
  if (/<\/|\/>|\|\||&&|===|!==|\?\./.test(value)) return false;
  const visible = value.replace(/\s+/g, "");
  if (!visible) return false;
  const cjkCount = (visible.match(/[\u3400-\u9fff]/g) || []).length;
  return cjkCount / visible.length >= 0.15;
}

function extractChineseStrings(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const results = [];
  const regex = /(?:'([^'\n]*[\u3400-\u9fff][^'\n]*)'|"([^"\n]*[\u3400-\u9fff][^"\n]*)")/g;
  let match = regex.exec(text);
  while (match) {
    const value = (match[1] || match[2] || "").trim();
    if (value && !value.includes("\\n") && !value.includes("\\t") && looksLikeHumanSentence(value)) {
      results.push(value);
    }
    match = regex.exec(text);
  }
  return results;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeCache(cache) {
  ensureDir(path.dirname(CACHE_PATH));
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateText(text, targetLang, retry = 0) {
  const query = new URLSearchParams({
    client: "gtx",
    sl: "zh-CN",
    tl: targetLang,
    dt: "t",
    q: text,
  });
  const url = `https://translate.googleapis.com/translate_a/single?${query.toString()}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "merchant-space-dom-translator/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json();
    if (!Array.isArray(json) || !Array.isArray(json[0])) {
      return text;
    }
    return json[0].map((item) => (Array.isArray(item) ? item[0] : "")).join("").trim() || text;
  } catch {
    if (retry < 3) {
      await delay(250 * (retry + 1));
      return translateText(text, targetLang, retry + 1);
    }
    console.warn(`[translate] failed (${targetLang}) for: ${text}`);
    return text;
  }
}

async function runWithConcurrency(items, worker, concurrency) {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      await worker(next);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const files = walkFiles(SRC_DIR);
  const sources = new Set();
  files.forEach((filePath) => {
    extractChineseStrings(filePath).forEach((item) => sources.add(item));
  });
  const sourceList = [...sources];
  console.log(`[dom-i18n] extracted ${sourceList.length} chinese strings`);

  const cache = readCache();
  const result = {};
  sourceList.forEach((source) => {
    result[source] = cache[source] || {};
  });

  const tasks = [];
  sourceList.forEach((source) => {
    TARGET_LANGS.forEach((lang) => {
      if (result[source]?.[lang]) return;
      tasks.push({ source, lang });
    });
  });

  let done = 0;
  const total = tasks.length;
  console.log(`[dom-i18n] translate tasks: ${total}`);

  await runWithConcurrency(
    tasks,
    async ({ source, lang }) => {
      const translated = await translateText(source, lang);
      if (!result[source]) result[source] = {};
      result[source][lang] = translated || source;
      done += 1;
      if (done % 50 === 0 || done === total) {
        console.log(`[dom-i18n] progress ${done}/${total}`);
        writeCache(result);
      }
    },
    CONCURRENCY,
  );

  writeCache(result);
  const normalized = {};
  Object.keys(result)
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .forEach((source) => {
      const item = result[source] || {};
      normalized[source] = {
        "zh-TW": item["zh-TW"] || source,
        ja: item.ja || source,
        ko: item.ko || source,
        en: item.en || source,
      };
    });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(normalized, null, 2), "utf8");
  console.log(`[dom-i18n] wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
