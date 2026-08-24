const DARK_CHANNEL_LIMIT = 105;

function isDarkPixel(data, pixelIndex) {
  const offset = pixelIndex * 4;
  return data[offset + 3] > 96
    && data[offset] < DARK_CHANNEL_LIMIT
    && data[offset + 1] < DARK_CHANNEL_LIMIT
    && data[offset + 2] < DARK_CHANNEL_LIMIT;
}

function componentGap(left, right) {
  const horizontal = Math.max(0, Math.max(left.x1, right.x1) - Math.min(left.x2, right.x2));
  const vertical = Math.max(0, Math.max(left.y1, right.y1) - Math.min(left.y2, right.y2));
  return { horizontal, vertical };
}

function clusterComponents(components) {
  const remaining = new Set(components.map((_, index) => index));
  const clusters = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    remaining.delete(first);
    const queue = [first];
    const cluster = [];
    while (queue.length) {
      const index = queue.pop();
      const component = components[index];
      cluster.push(component);
      for (const candidateIndex of [...remaining]) {
        const gap = componentGap(component, components[candidateIndex]);
        if (gap.horizontal <= 8 && gap.vertical <= 2) {
          remaining.delete(candidateIndex);
          queue.push(candidateIndex);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/**
 * 족보 이미지에 반복 삽입된 굵은 `zocbo.com` 글자의 픽셀 군집을 찾는다.
 * 워터마크 위치와 관계없이 비율, 글자 군집 수와 밀도를 모두 만족하는
 * 경우에만 영역을 반환한다.
 */
export function findZocboWatermarkBounds({ data, width, height }) {
  if (!data || width < 120 || height < 80) return null;
  const startY = 0;
  const scanHeight = height - startY;
  const mask = new Uint8Array(width * scanHeight);
  for (let y = startY; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (isDarkPixel(data, pixelIndex)) mask[(y - startY) * width + x] = 1;
    }
  }

  const components = [];
  const stack = [];
  for (let localY = 0; localY < scanHeight; localY += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = localY * width + x;
      if (!mask[start]) continue;
      mask[start] = 0;
      stack.push(start);
      let x1 = x;
      let x2 = x + 1;
      let y1 = localY + startY;
      let y2 = y1 + 1;
      let area = 0;
      while (stack.length) {
        const index = stack.pop();
        const pointY = Math.floor(index / width);
        const pointX = index - pointY * width;
        const absoluteY = pointY + startY;
        area += 1;
        x1 = Math.min(x1, pointX);
        x2 = Math.max(x2, pointX + 1);
        y1 = Math.min(y1, absoluteY);
        y2 = Math.max(y2, absoluteY + 1);
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const nextY = pointY + offsetY;
          if (nextY < 0 || nextY >= scanHeight) continue;
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const nextX = pointX + offsetX;
            if (nextX < 0 || nextX >= width) continue;
            const next = nextY * width + nextX;
            if (!mask[next]) continue;
            mask[next] = 0;
            stack.push(next);
          }
        }
      }
      const componentWidth = x2 - x1;
      const componentHeight = y2 - y1;
      if (
        area >= 8
        && componentWidth <= Math.max(48, width * 0.12)
        && componentHeight >= 3
        && componentHeight <= Math.max(42, height * 0.09)
      ) {
        components.push({ x1, y1, x2, y2, area });
      }
    }
  }

  const candidates = clusterComponents(components).map((cluster) => {
    const x1 = Math.min(...cluster.map((item) => item.x1));
    const y1 = Math.min(...cluster.map((item) => item.y1));
    const x2 = Math.max(...cluster.map((item) => item.x2));
    const y2 = Math.max(...cluster.map((item) => item.y2));
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;
    const area = cluster.reduce((sum, item) => sum + item.area, 0);
    const aspect = boxWidth / Math.max(1, boxHeight);
    const density = area / Math.max(1, boxWidth * boxHeight);
    return { x1, y1, x2, y2, width: boxWidth, height: boxHeight, aspect, density, parts: cluster.length };
  }).filter((box) => (
    box.width >= Math.max(80, width * 0.2)
    && box.width <= Math.min(240, width * 0.62)
    && box.height >= 12
    && box.height <= 42
    && box.aspect >= 4.3
    && box.aspect <= 9.5
    && box.density >= 0.24
    && box.parts >= 5
    && box.parts <= 13
  ));
  if (!candidates.length) return null;
  candidates.sort((left, right) => (
    Math.abs(left.aspect - 6.2) - Math.abs(right.aspect - 6.2)
    || right.density - left.density
    || right.y1 - left.y1
  ));
  const match = candidates[0];
  const margin = Math.max(3, Math.round(match.height * 0.16));
  return {
    x: Math.max(0, match.x1 - margin),
    y: Math.max(0, match.y1 - margin),
    width: Math.min(width, match.x2 + margin) - Math.max(0, match.x1 - margin),
    height: Math.min(height, match.y2 + margin) - Math.max(0, match.y1 - margin),
  };
}

function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("보정한 이미지를 저장하지 못했습니다."))),
      type,
      type === "image/jpeg" ? 0.96 : undefined,
    );
  });
}

export async function coverZocboWatermark(bytes, type) {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return { bytes, bounds: null };
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const bounds = findZocboWatermarkBounds(imageData);
    if (!bounds) return { bytes, bounds: null };
    context.fillStyle = "#FFFFFF";
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    const blob = await canvasBlob(canvas, type);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), bounds };
  } finally {
    bitmap.close?.();
  }
}
