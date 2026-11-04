import assert from "node:assert/strict";
import test from "node:test";
import { BOOKING_COUNTRY_TIME_ZONES } from "./merchantBookingTimeZoneData";
import { filterBookingTimeZoneOptions, getBookingTimeZoneOptions, readBookingTimeZoneDefault } from "./merchantBookingTimeZoneOptions";
import { resolveMerchantBookingTimeZoneDefault } from "./merchantBookingTimeZoneLocation.server";
import { getEuropeProvinceOptions } from "./europeLocationOptions";

test("merchant geography distinguishes mainland Spain, both Canary provinces, Ceuta and Melilla", () => {
  for (const province of getEuropeProvinceOptions("ES")) {
    const expected = ["35", "38"].includes(province.code) ? "Atlantic/Canary" : ["51", "52"].includes(province.code) ? "Africa/Ceuta" : "Europe/Madrid";
    assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: "ES", provinceCode: province.code }).timeZone, expected);
    assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: "ES", province: province.name }).timeZone, expected);
  }
  assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: " es ", city: "Sevilla" }).timeZone, "Europe/Madrid");
  assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: "ES", city: "Las Palmas de Gran Canaria" }).timeZone, "Atlantic/Canary");
  assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: "ES", provinceCode: "ES-38" }).timeZone, "Atlantic/Canary");
});

test("Portugal distinguishes mainland, Azores and Madeira using saved subdivisions", () => {
  for (const province of getEuropeProvinceOptions("PT")) {
    const expected = province.code === "20" ? "Atlantic/Azores" : province.code === "30" ? "Atlantic/Madeira" : "Europe/Lisbon";
    assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: "PT", provinceCode: province.code }).timeZone, expected);
  }
  assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: "PT", province: "Açores" }).timeZone, "Atlantic/Azores");
});

test("single-zone countries default locally; ambiguous, missing and conflicting geography never guesses", () => {
  assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: "FR" }).timeZone, "Europe/Paris");
  assert.equal(resolveMerchantBookingTimeZoneDefault({ countryCode: "GB" }).timeZone, "Europe/London");
  for (const location of [null, {}, { countryCode: "ES" }, { countryCode: "PT" }, { countryCode: "US" }, { countryCode: "__proto__" },
    { countryCode: "ES", provinceCode: "41", province: "Santa Cruz de Tenerife" },
    { countryCode: "ES", provinceCode: "41", city: "Las Palmas de Gran Canaria" },
    { countryCode: "ES", city: "Santa Cruz" }]) {
    assert.equal(resolveMerchantBookingTimeZoneDefault(location).timeZone, "", JSON.stringify(location));
  }
});

test("options are real IANA identifiers, country-prioritized, searchable, and retain valid saved aliases", () => {
  assert.equal(Object.keys(BOOKING_COUNTRY_TIME_ZONES).length, 247);
  for (const locale of ["zh-CN", "es-ES", "en-GB"]) {
    const options = getBookingTimeZoneOptions(locale, "ES", "US/Eastern");
    assert.ok(options.length > 400);
    assert.equal(new Set(options.map((option) => option.value)).size, options.length);
    assert.equal(options[0].local, true);
    assert.equal(options.filter((option) => option.local).length, 3);
    assert.ok(options.some((option) => option.value === "US/Eastern"));
    assert.ok(options.some((option) => option.value === "UTC"));
    assert.ok(filterBookingTimeZoneOptions(options, "Atlantic canary", "Europe/Madrid").some((option) => option.value === "Atlantic/Canary"));
    assert.deepEqual(filterBookingTimeZoneOptions(options, "zz-no-match", "US/Eastern").map((option) => option.value), ["US/Eastern"]);
  }
  assert.ok(filterBookingTimeZoneOptions(getBookingTimeZoneOptions("zh-CN"), "加那利", "").some((option) => option.value === "Atlantic/Canary"));
  assert.ok(filterBookingTimeZoneOptions(getBookingTimeZoneOptions("es-ES"), "Espana", "").some((option) => option.value === "Europe/Madrid"));
});

test("default metadata is validated and cannot supply an unrelated zone or corrupt identifier", () => {
  assert.deepEqual(readBookingTimeZoneDefault({ countryCode: "ES", timeZone: "Atlantic/Canary" }), { countryCode: "ES", timeZone: "Atlantic/Canary" });
  assert.equal(readBookingTimeZoneDefault({ countryCode: "ES", timeZone: "America/New_York" }).timeZone, "");
  for (const value of [null, {}, { countryCode: "__proto__", timeZone: "UTC" }, { countryCode: "ES", timeZone: "invalid" }]) {
    assert.equal(readBookingTimeZoneDefault(value).timeZone, "");
  }
});
