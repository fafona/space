import assert from "node:assert/strict";
import test from "node:test";
import { resolveAdaptiveMerchantListEntries, resolveMerchantListLayoutEntries } from "./merchantCardLayout";

test("keeps merchant layout unchanged when translated labels still fit", () => {
  const base = resolveMerchantListLayoutEntries(undefined, 3, 3);
  const adapted = resolveAdaptiveMerchantListEntries(base, {
    availableWidth: 360,
    tabLabels: ["推荐", "餐饮", "服务"],
    prevLabel: "上一页",
    nextLabel: "下一页",
  });

  assert.deepEqual(
    adapted.map((item) => ({ key: item.key, x: item.x, y: item.y, width: item.width, height: item.height })),
    base.map((item) => ({ key: item.key, x: item.x, y: item.y, width: item.width, height: item.height })),
  );
});

test("reflows merchant tabs and shifts cards down when translated labels grow", () => {
  const base = resolveMerchantListLayoutEntries(undefined, 3, 4);
  const adapted = resolveAdaptiveMerchantListEntries(base, {
    availableWidth: 360,
    tabLabels: [
      "Sitio comercial",
      "Guía de creación de sitios web",
      "Función de tarjeta de visita",
      "Contáctenos",
    ],
    prevLabel: "Página anterior",
    nextLabel: "Página siguiente",
  });

  const baseCard1 = base.find((item) => item.key === "card1");
  const adaptedCard1 = adapted.find((item) => item.key === "card1");
  const adaptedTab2 = adapted.find((item) => item.key === "tab2");
  const adaptedTab3 = adapted.find((item) => item.key === "tab3");
  const adaptedPrev = adapted.find((item) => item.key === "prev");

  assert.ok(baseCard1 && adaptedCard1 && adaptedTab2 && adaptedTab3 && adaptedPrev);
  assert.ok(adaptedCard1.y > baseCard1.y);
  assert.ok(adaptedTab2.width > 108);
  assert.ok(adaptedTab3.y >= adaptedTab2.y);
  assert.ok(adaptedPrev.width > 92);
});

test("keeps custom pager positions instead of forcing them back to the default corner", () => {
  const base = resolveMerchantListLayoutEntries(
    {
      prev: { x: 520, y: 680, width: 92, height: 34 },
      next: { x: 624, y: 680, width: 92, height: 34 },
    },
    8,
    6,
  );
  const adapted = resolveAdaptiveMerchantListEntries(base, {
    availableWidth: 820,
    tabLabels: ["Recommended", "Food", "Entertainment", "Retail", "Services", "Organization"],
    prevLabel: "Previous",
    nextLabel: "Next",
  });

  const adaptedPrev = adapted.find((item) => item.key === "prev");
  const adaptedNext = adapted.find((item) => item.key === "next");

  assert.ok(adaptedPrev && adaptedNext);
  assert.equal(adaptedPrev.x, 520);
  assert.equal(adaptedPrev.y, 680);
  assert.equal(adaptedNext.x, 624);
  assert.equal(adaptedNext.y, 680);
});
