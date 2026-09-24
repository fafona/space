import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { filterCatalogProductList } from "./MerchantCatalogProductList";
import type { MerchantCatalogProduct } from "@/lib/merchantCatalog";

const source = readFileSync(new URL("./MerchantCatalogProductList.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
type Element = { type: string; props: Record<string, unknown> };
function products(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `Product ${i + 1}`, code: `Code-${i + 1}`, tag: "", description: "", price: "1", imageUrl: "", thumbnailUrl: "", availability: "available" } as MerchantCatalogProduct));
}
function harness(initial = products(123)) {
  let cursor = 0, dirty = false, items = initial;
  const slots: unknown[] = [], selected = new Set<string>();
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const exports = {} as { default: (props: Record<string, unknown>) => Element };
  new Script(compiled).runInNewContext({ exports, require(name: string) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return {
      useMemo: (fn: () => unknown) => fn(),
      useState(initialValue: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initialValue;
        return [slots[index], (value: unknown) => { slots[index] = value; dirty = true; }];
      },
    };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  function render(): Element {
    cursor = 0; dirty = false;
    const tree = exports.default({ products: items, label: "测试商品", searchable: true, children: (p: MerchantCatalogProduct) => jsx("input", {
      type: "checkbox", value: p.id, checked: selected.has(p.id), onChange: (checked: boolean) => checked ? selected.add(p.id) : selected.delete(p.id),
    }) });
    return dirty ? render() : tree;
  }
  function all(tree: unknown): Element[] {
    if (Array.isArray(tree)) return tree.flatMap(all);
    if (!tree || typeof tree !== "object") return [];
    const item = tree as Element;
    return [item, ...all(item.props?.children)];
  }
  const rows = () => all(render()).filter(e => e.type === "input" && e.props.type === "checkbox");
  const button = (name: string) => all(render()).find(e => e.type === "button" && e.props.children === name)!;
  return { rows, selected, button,
    keydown: (event: unknown) => (all(render()).find(e => e.type === "input" && e.props.type === "search")!.props.onKeyDown as (event: unknown) => void)(event),
    next: () => (button("下一页").props.onClick as () => void)(),
    prev: () => (button("上一页").props.onClick as () => void)(),
    search: (value: string) => (all(render()).find(e => e.type === "input" && e.props.type === "search")!.props.onChange as (event: unknown) => void)({ target: { value } }),
    replace: (value: MerchantCatalogProduct[]) => { items = value; },
  };
}

test("actual catalog view mounts at most 50 rows, visits every item once and disables boundary controls", () => {
  const app = harness();
  assert.equal(app.button("上一页").props.disabled, true);
  const ids: unknown[] = [];
  for (const count of [50, 50, 23]) {
    const rows = app.rows();
    assert.equal(rows.length, count);
    ids.push(...rows.map(r => r.props.value));
    if (count === 50) app.next();
  }
  assert.deepEqual(ids, products(123).map(p => p.id));
  assert.equal(app.button("下一页").props.disabled, true);
});

test("search finds products outside current page, resets pagination and never drops selection", () => {
  const app = harness();
  (app.rows()[0].props.onChange as (checked: boolean) => void)(true);
  app.next();
  (app.rows()[0].props.onChange as (checked: boolean) => void)(true);
  app.search("code-123");
  assert.deepEqual(app.rows().map(r => r.props.value), ["p123"]);
  assert.equal(app.button("上一页").props.disabled, true);
  app.search("");
  assert.equal(app.rows()[0].props.checked, true);
  app.next();
  assert.equal(app.rows()[0].props.checked, true);
  assert.deepEqual([...app.selected], ["p1", "p51"]);
});

test("shrinking datasets clamp to a valid page without retaining stale page on regrowth", () => {
  const app = harness();
  app.next(); app.next();
  app.replace(products(51));
  assert.deepEqual(app.rows().map(r => r.props.value), ["p51"]);
  app.replace(products(123));
  assert.equal(app.rows()[0].props.value, "p51");
  app.replace([]);
  assert.equal(app.rows().length, 0);
  assert.equal(app.button("上一页").props.disabled, true);
  assert.equal(app.button("下一页").props.disabled, true);
});

test("search Enter never implicitly saves its surrounding category or collection form", () => {
  const app = harness();
  let prevented = 0;
  app.keydown({ key: "Enter", nativeEvent: { isComposing: false }, preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
  app.keydown({ key: "Enter", nativeEvent: { isComposing: true }, preventDefault: () => { prevented++; } });
  app.keydown({ key: "a", nativeEvent: { isComposing: false }, preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
});

test("catalog filtering preserves full search semantics, ordering, object references and source values", () => {
  const input = products(1000);
  input[999] = { ...input[999], name: "稀有商品", description: "UNIQUE Description", tag: "尾页分类" };
  const before = JSON.stringify(input);
  for (const query of ["  p1000  ", "CODE-1000", "稀有商品", "unique description", "尾页分类"]) {
    const result = filterCatalogProductList(input, query);
    assert.equal(result.length, 1);
    assert.equal(result[0], input[999]);
  }
  assert.equal(filterCatalogProductList(input, " "), input);
  assert.equal(JSON.stringify(input), before);
});

test("all catalog product views use bounded view keys and full draft selection arrays", () => {
  const panel = readFileSync(new URL("./MerchantCatalogManagerPanel.tsx", import.meta.url), "utf8");
  assert.equal((panel.match(/<MerchantCatalogProductList /g) || []).length, 4);
  assert.doesNotMatch(panel, /\{(?:catalog\.products|filteredProducts)\.map\(/);
  for (const identity of ["`${siteId}:readonly`", "`${siteId}:products:${productSearch}`", "`${siteId}:collection:${collectionDraft.id}`", "`${siteId}:category:${categoryDraft.id}`"]) assert.ok(panel.includes(`key={${identity}}`));
  assert.ok(panel.includes("[...new Set([...collectionDraft.productIds, product.id])]"));
  assert.ok(panel.includes("[...categoryDraft.productIds, product.id]"));
});
