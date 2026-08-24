import assert from "node:assert/strict";
import test from "node:test";
import { findZocboWatermarkBounds } from "./image-watermark.js";

function image(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const fill = (x, y, boxWidth, boxHeight) => {
    for (let py = y; py < y + boxHeight; py += 1) {
      for (let px = x; px < x + boxWidth; px += 1) {
        const offset = (py * width + px) * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  };
  return { data, width, height, fill };
}

test("하단의 굵은 zocbo.com 형태 글자 군집만 찾는다", () => {
  const fixture = image(500, 620);
  const widths = [15, 16, 15, 28, 5, 15, 16, 23];
  let x = 292;
  widths.forEach((partWidth, index) => {
    fixture.fill(x, index === 4 ? 541 : 526, partWidth, index === 4 ? 5 : 20);
    x += partWidth + 2;
  });
  const bounds = findZocboWatermarkBounds(fixture);
  assert.ok(bounds);
  assert.ok(bounds.x <= 292);
  assert.ok(bounds.y <= 526);
  assert.ok(bounds.x + bounds.width >= x - 2);
});

test("하단에 있어도 짧은 도형 캡션은 워터마크로 판단하지 않는다", () => {
  const fixture = image(500, 620);
  fixture.fill(180, 580, 90, 24);
  assert.equal(findZocboWatermarkBounds(fixture), null);
});
