import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  containsRichMarkup,
  escapePlainTextAsHtml,
  toPlainRichText,
} from "@/lib/richTextSafety";

test("rich text is reduced to inert plain text", () => {
  const input = '<p>Hello <strong>world</strong></p><img src=x onerror="steal()"><script>steal()</script><div>next&nbsp;line</div>';
  assert.equal(toPlainRichText(input), "Hello world\nnext line\n");
  assert.equal(containsRichMarkup(input), true);
});

test("plain text HTML output escapes every executable delimiter", () => {
  assert.equal(
    escapePlainTextAsHtml('<b title="x">A & B</b>\n\'quoted\''),
    "A &amp; B<br />&#39;quoted&#39;",
  );
});

test("numeric entities decode without a DOM parser", () => {
  assert.equal(toPlainRichText("A&#32;B&#x21;"), "A B!");
});

test("inline editor restores inert text without assigning HTML", () => {
  const source = readFileSync(
    new URL("../components/admin/InlineEditorBlock.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /editor\.textContent = snapshot\.text;/);
});
