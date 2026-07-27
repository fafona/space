import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLinearGradient,
  isGradientToken,
  normalizeHexColor,
  normalizeRecentColorToken,
  parseGradientValue,
} from "./editorColors";

test("editor colors normalize solid and recent values", () => {
  assert.equal(normalizeHexColor(" #AABBCC "), "#aabbcc");
  assert.equal(normalizeHexColor("#abc"), null);
  assert.equal(normalizeRecentColorToken(" #AABBCC "), "#aabbcc");
  assert.equal(normalizeRecentColorToken("rgb(0, 0, 0)"), null);
});

test("editor colors parse and rebuild supported gradients", () => {
  const gradient = "linear-gradient(to bottom right, #AABBCC 0%, #112233 100%)";
  assert.deepEqual(parseGradientValue(gradient), {
    mode: "gradient",
    solidColor: "#ffffff",
    startColor: "#aabbcc",
    endColor: "#112233",
    direction: "to bottom right",
  });
  assert.equal(buildLinearGradient("to bottom right", "#AABBCC", "#112233"), gradient.toLowerCase());
  assert.equal(isGradientToken(gradient), true);
});

test("editor colors fall back safely for unsupported input", () => {
  assert.deepEqual(parseGradientValue("radial-gradient(#fff, #000)"), {
    mode: "solid",
    solidColor: "#ffffff",
    startColor: "#ffffff",
    endColor: "#000000",
    direction: "to right",
  });
  assert.equal(
    buildLinearGradient("to right", "invalid", "invalid"),
    "linear-gradient(to right, #ffffff 0%, #000000 100%)",
  );
});
