import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBookingOptionPresentations } from "./bookingOptionPresentation";

test("booking option localization never changes canonical submitted values", () => {
  const canonical = ["咨询预约", "到店服务"];
  const translated = new Map([
    ["咨询预约", "Reserva de consulta"],
    ["到店服务", "Servicio en tienda"],
  ]);

  const options = buildBookingOptionPresentations(
    canonical,
    (value) => translated.get(value) ?? value,
  );

  assert.deepEqual(options, [
    { value: "咨询预约", label: "Reserva de consulta" },
    { value: "到店服务", label: "Servicio en tienda" },
  ]);
  assert.deepEqual(
    options.map((option) => option.value),
    canonical,
  );
});

test("booking option labels fall back without rewriting custom values", () => {
  assert.deepEqual(
    buildBookingOptionPresentations(["Custom service"], (value) => value),
    [{ value: "Custom service", label: "Custom service" }],
  );
});

test("BookingBlock renders all three selects with canonical values and localized labels", () => {
  const source = readFileSync(
    new URL("./BookingBlock.tsx", import.meta.url),
    "utf8",
  );
  for (const collection of [
    "storeOptionPresentations",
    "itemOptionPresentations",
    "titleOptionPresentations",
  ]) {
    assert.match(source, new RegExp(`${collection}\\.map\\(\\(option\\)`));
  }
  assert.equal(source.match(/value=\{option\.value\}/g)?.length, 3);
  assert.equal(source.match(/\{option\.label\}/g)?.length, 3);
  assert.doesNotMatch(source, /value=\{option\.label\}/);
});
