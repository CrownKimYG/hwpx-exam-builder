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

function fillWatermark(fixture, startX, startY) {
  const widths = [15, 16, 15, 28, 5, 15, 16, 23];
  let x = startX;
  widths.forEach((partWidth, index) => {
    fixture.fill(x, index === 4 ? startY + 15 : startY, partWidth, index === 4 ? 5 : 20);
    x += partWidth + 2;
  });
  return x;
}

test("하단 오른쪽의 굵은 zocbo.com 형태 글자 군집을 찾는다", () => {
  const fixture = image(500, 620);
  const x = fillWatermark(fixture, 292, 526);
  const bounds = findZocboWatermarkBounds(fixture);
  assert.ok(bounds);
  assert.ok(bounds.x <= 292);
  assert.ok(bounds.y <= 526);
  assert.ok(bounds.x + bounds.width >= x - 2);
});

test("이미지 어느 위치의 zocbo.com 형태 글자 군집도 찾는다", () => {
  const positions = [
    [10, 12],
    [180, 250],
    [28, 526],
    [335, 80],
  ];
  positions.forEach(([x, y]) => {
    const fixture = image(500, 620);
    const endX = fillWatermark(fixture, x, y);
    const bounds = findZocboWatermarkBounds(fixture);
    assert.ok(bounds, `${x}, ${y}의 워터마크를 찾지 못했습니다.`);
    assert.ok(bounds.x <= x);
    assert.ok(bounds.y <= y);
    assert.ok(bounds.x + bounds.width >= endX - 2);
  });
});

test("인접한 도형 라벨은 제외하고 zocbo.com 부분군집만 찾는다", () => {
  const fixture = image(548, 418);
  const endX = fillWatermark(fixture, 369, 395);
  const labelX = endX + 4;
  fixture.fill(labelX, 376, 24, 42);

  const bounds = findZocboWatermarkBounds(fixture);
  assert.ok(bounds);
  assert.ok(bounds.x <= 369);
  assert.ok(bounds.x + bounds.width >= endX - 2);
  assert.ok(bounds.x + bounds.width < labelX);
});

test("넓은 이미지의 고정 크기 zocbo.com도 찾는다", () => {
  const fixture = image(900, 600);
  const endX = fillWatermark(fixture, 100, 220);
  const bounds = findZocboWatermarkBounds(fixture);
  assert.ok(bounds);
  assert.ok(bounds.x <= 100);
  assert.ok(bounds.x + bounds.width >= endX - 2);
});

test("하단에 있어도 짧은 도형 캡션은 워터마크로 판단하지 않는다", () => {
  const fixture = image(500, 620);
  fixture.fill(180, 580, 90, 24);
  assert.equal(findZocboWatermarkBounds(fixture), null);
});
