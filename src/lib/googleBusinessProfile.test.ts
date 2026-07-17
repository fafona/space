import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleBusinessProfileLocationKey,
  findGoogleBusinessProfileLocation,
  type GoogleBusinessProfileLocation,
} from "./googleBusinessProfile";

const locations: GoogleBusinessProfileLocation[] = [
  {
    accountName: "accounts/123",
    name: "locations/456",
    title: "Faolla Madrid",
    address: "Madrid",
    mapsUri: "https://maps.google.com/example",
    newReviewUri: "https://search.google.com/local/writereview?placeid=example",
    websiteUri: "https://www.faolla.com",
  },
];

test("builds stable location keys and resolves an exact account/location pair", () => {
  assert.equal(buildGoogleBusinessProfileLocationKey(" accounts/123 ", " locations/456 "), "accounts/123::locations/456");
  assert.equal(findGoogleBusinessProfileLocation(locations, "accounts/123", "locations/456")?.title, "Faolla Madrid");
  assert.equal(findGoogleBusinessProfileLocation(locations, "accounts/999", "locations/456"), null);
});
