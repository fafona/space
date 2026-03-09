import test from "node:test";
import assert from "node:assert/strict";
import { resolveReverseGeocodeLocation } from "./reverseGeocodeLocation";

test("prefers province-level administrative entry over principal subdivision for Sevilla", () => {
  const resolved = resolveReverseGeocodeLocation({
    countryCode: "ES",
    principalSubdivision: "Andalusia",
    city: "Sevilla",
    localityInfo: {
      administrative: [
        { name: "Spain", adminLevel: 2, description: "country" },
        { name: "Andalusia", adminLevel: 4, description: "autonomous community of Spain" },
        { name: "Provincia de Sevilla", adminLevel: 6, description: "province of Spain" },
        { name: "Sevilla", adminLevel: 8, description: "municipality of Andalusia, Spain" },
      ],
    },
  });

  assert.deepEqual(resolved, {
    provinceName: "Sevilla",
    cityName: "Sevilla",
    provinceSource: "administrative:6",
    citySource: "city",
  });
});

test("strips provincia prefix for Valencia", () => {
  const resolved = resolveReverseGeocodeLocation({
    countryCode: "ES",
    principalSubdivision: "Comunitat Valenciana",
    city: "Valencia",
    localityInfo: {
      administrative: [
        { name: "Comunitat Valenciana", adminLevel: 4, description: "autonomous community of Spain" },
        { name: "Provincia de Valencia", adminLevel: 6, description: "province of Spain" },
      ],
    },
  });

  assert.equal(resolved.provinceName, "Valencia");
  assert.equal(resolved.cityName, "Valencia");
});

test("falls back to principal subdivision when province-level entry is absent", () => {
  const resolved = resolveReverseGeocodeLocation({
    countryCode: "IE",
    principalSubdivision: "Leinster",
    localityName: "Dublin",
    localityInfo: {
      administrative: [{ name: "Ireland", adminLevel: 2, description: "country" }],
    },
  });

  assert.deepEqual(resolved, {
    provinceName: "Leinster",
    cityName: "Dublin",
    provinceSource: "principalSubdivision",
    citySource: "localityName",
  });
});
