import test from "node:test";
import assert from "node:assert/strict";
import { findBestCityName, findEuropeCountryByCode, getEuropeCityOptions, getEuropeCountryOptions, getEuropeProvinceOptions } from "./europeLocationOptions";

test("includes China in supported country options", () => {
  const countries = getEuropeCountryOptions();
  const china = countries.find((item) => item.code === "CN");
  assert.ok(china);
  assert.equal(china?.name, "China");
});

test("exposes China provinces and prefecture-level cities", () => {
  const china = findEuropeCountryByCode("CN");
  assert.ok(china);
  const provinces = getEuropeProvinceOptions("CN");
  const guangdong = provinces.find((item) => item.code === "44");
  assert.ok(guangdong);
  assert.equal(guangdong?.name, "广东省");
  const cities = getEuropeCityOptions("CN", "44");
  assert.ok(cities.includes("广州市"));
  assert.ok(cities.includes("深圳市"));
  assert.equal(findBestCityName("CN", "44", "深圳市"), "深圳市");
});
