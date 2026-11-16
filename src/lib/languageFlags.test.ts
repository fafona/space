import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LANGUAGE_OPTIONS } from "./i18n";
import { languageFlagImageUrl, isLocalLanguageFlagPath } from "./languageFlags";

test("every supported language has a small inert local flag with no external image dependency", () => {
  const paths = new Set<string>();
  for (const language of LANGUAGE_OPTIONS) {
    const url = languageFlagImageUrl(language.countryCode);
    assert.equal(isLocalLanguageFlagPath(url), true);
    const svg = fs.readFileSync("public" + url, "utf8");
    assert.ok(svg.length < 16384);
    assert.match(svg, /href="data:image\/png;base64,/);
    assert.doesNotMatch(svg, /<script|foreignObject|https?:\/\/(?!www\.w3\.org\/2000\/svg)|\bon\w+=/);
    paths.add(url);
  }
  assert.equal(paths.size, 39);
  for (const bad of ["/flags/xx.svg", "/flags/es.svg/extra", "/flags/../secret.svg", "/flags/ES.svg", "/flags/sources.json"]) assert.equal(isLocalLanguageFlagPath(bad), false);
  assert.equal(languageFlagImageUrl("../../secret"), "/flags/cn.svg");
});
