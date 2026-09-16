import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8");
const gate = source.slice(source.indexOf("verify_nginx_release_static_access() {"));
const block = gate.match(/          test -n "\$relative_path"[\s\S]+?request_path="\$\{request_path\/\/\\\]\/%5D\}"/)?.[0];
assert.ok(block, "real deployment path validation and URL encoding block");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const run = value => spawnSync(bash, ["-s"], {
  input: `set -eu\nrelative_path="$TEST_ASSET_PATH"\n${block}\nprintf '%s' "$request_path"\n`,
  encoding: "utf8", timeout: 5000, windowsHide: true,
  env: { ...process.env, TEST_ASSET_PATH: value },
});

test("actual nginx asset gate accepts and URL-encodes Next dynamic route chunks", () => {
  for (const path of ["chunks/app/[merchantEntry]/page-123.js", "chunks/app/api/proxy/[...path]/route-123.js",
    "chunks/app/[[...optional]]/page-456.js", "css/a-b_123.css", "chunks/webpack-123.js"]) {
    const result = run(path);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, path.replaceAll("[", "%5B").replaceAll("]", "%5D"));
  }
  assert.match(gate, /curl --fail --silent --show-error --insecure --globoff/);
  assert.match(gate, /_next\/static\/\$request_path\?__faollaNginxGate=/);
});

test("actual nginx asset gate rejects traversal, absolute paths and URL/shell metacharacters", () => {
  for (const path of ["", "/a", "../secret", "a/../secret", "a/..", "..", "./a", "a/./b", "a/.", ".",
    "a//b", "a/", "a%2fb", "a?b", "a#b", "a b", "a\\b", "a\nb", "a\rb", "a$(id)", "a;b", "a:b", "a*b"]) {
    const result = run(path);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, path);
    assert.equal(result.stdout, "");
  }
});
