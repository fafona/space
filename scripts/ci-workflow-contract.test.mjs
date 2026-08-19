import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const lockfile = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);

function jobBlock(jobName) {
  const marker = `  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing ${jobName} job`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/\n  [a-zA-Z0-9_-]+:\n/);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

function assertSharedEnvironment(job) {
  assert.match(job, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*true/);
  assert.match(job, /NEXT_PUBLIC_SUPABASE_URL:\s*https:\/\/example\.supabase\.co/);
  assert.match(job, /NEXT_PUBLIC_SUPABASE_ANON_KEY:\s*dummy-anon-key/);
}

test("CI keeps quality checks independent from browser system packages", () => {
  const quality = jobBlock("quality");

  assert.match(quality, /name:\s*Quality/);
  assert.match(quality, /runs-on:\s*ubuntu-latest/);
  assert.match(quality, /timeout-minutes:\s*[1-9][0-9]*/);
  assertSharedEnvironment(quality);
  assert.match(quality, /node --test scripts\/ci-workflow-contract\.test\.mjs/);
  assert.match(quality, /actions\/checkout@v5/);
  assert.match(quality, /actions\/setup-node@v5/);
  assert.match(quality, /run:\s*npm ci/);
  assert.match(quality, /run:\s*npm run check:encoding:strict/);
  assert.match(quality, /run:\s*npm run lint -- --max-warnings=9999/);
  assert.match(quality, /run:\s*npm test/);
  assert.match(quality, /run:\s*npm run build/);
  assert.doesNotMatch(quality, /playwright install|test:enterprise-browser|apt-get/);
});

test("browser journeys use the lockfile-matched official Playwright image", () => {
  const browser = jobBlock("browser");
  const lockedVersion = lockfile.packages?.["node_modules/playwright"]?.version;
  const imageVersion = browser.match(
    /image:\s*mcr\.microsoft\.com\/playwright:v([^\s-]+)-noble/,
  )?.[1];

  assert.equal(typeof lockedVersion, "string");
  assert.equal(imageVersion, lockedVersion);
  assert.match(browser, /name:\s*Enterprise Browser Journeys/);
  assert.match(browser, /needs:\s*quality/);
  assert.match(browser, /runs-on:\s*ubuntu-latest/);
  assert.match(browser, /timeout-minutes:\s*[1-9][0-9]*/);
  assert.match(browser, /options:\s*--user 1001/);
  assertSharedEnvironment(browser);
  assert.match(browser, /actions\/checkout@v5/);
  assert.match(browser, /actions\/setup-node@v5/);
  assert.match(browser, /run:\s*npm ci/);
  assert.match(browser, /run:\s*npm run build/);
  assert.match(browser, /run:\s*npm run test:enterprise-browser/);
  assert.doesNotMatch(browser, /continue-on-error|playwright install|apt-get/);
  assert.doesNotMatch(workflow, /playwright install --with-deps|apt-get/);
});
