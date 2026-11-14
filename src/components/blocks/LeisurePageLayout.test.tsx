import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LeisurePageLayout from "./LeisurePageLayout";
import type { Block } from "../../data/homeBlocks";

test("ordinary pages keep the original wrapper, class, style and editor boundary", () => {
  const html = renderToStaticMarkup(<LeisurePageLayout blocks={[]} defaultClassName="space-y-0" editorBoundary style={{ minHeight: 780 }}><p>Unchanged content</p></LeisurePageLayout>);
  assert.equal(html, '<div data-editor-viewport-boundary="true" class="space-y-0" style="min-height:780px"><p>Unchanged content</p></div>');
  assert.doesNotMatch(html, /faolla-leisure/);
});

test("opted-in pages use a named container and preserve all children and editor boundary", () => {
  const blocks: Block[] = [{ id: "synthetic", type: "text", props: { pagePresentation: "leisure-home-v1", heading: "Synthetic", text: "Example" } }];
  const html = renderToStaticMarkup(<LeisurePageLayout blocks={blocks} editorBoundary><p>Editable native content</p></LeisurePageLayout>);
  assert.match(html, /class="faolla-leisure-shell"/);
  assert.match(html, /data-editor-viewport-boundary="true" data-leisure-presentation="leisure-home-v1"/);
  assert.match(html, /Editable native content/);
});
