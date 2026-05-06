import assert from "node:assert/strict";
import test from "node:test";

import {
  clampCropRect,
  getPixelColor,
  moveCropRect,
  removeBackgroundPixels,
  removeConnectedBackgroundPixels,
  resizeCropRectFromHandle,
  resizeCropWithAspectRatio,
  type CropRect,
} from "./imageEditing.ts";

test("clampCropRect keeps a crop inside the image with at least one pixel", () => {
  const rect = clampCropRect(
    { x: -8, y: 6, width: 80, height: 0 },
    { width: 40, height: 24 }
  );

  assert.deepEqual(rect, { x: 0, y: 6, width: 40, height: 1 });
});

test("resizeCropWithAspectRatio preserves the selected aspect ratio from the anchor", () => {
  const rect = resizeCropWithAspectRatio(
    { x: 10, y: 10, width: 20, height: 20 },
    { x: 10, y: 10 },
    { x: 90, y: 50 },
    "16:9",
    { width: 120, height: 80 }
  );

  assert.equal(rect.width, 71);
  assert.equal(rect.height, 40);
  assert.equal(rect.x, 10);
  assert.equal(rect.y, 10);
});

test("resizeCropWithAspectRatio supports dragging up and left", () => {
  const rect = resizeCropWithAspectRatio(
    { x: 50, y: 30, width: 10, height: 10 },
    { x: 60, y: 40 },
    { x: 20, y: 20 },
    "1:1",
    { width: 100, height: 100 }
  );

  assert.deepEqual(rect, { x: 40, y: 20, width: 20, height: 20 });
});

test("moveCropRect moves an existing crop without leaving the image", () => {
  const rect = moveCropRect(
    { x: 20, y: 10, width: 30, height: 20 },
    { x: 5, y: 8 },
    { width: 60, height: 40 }
  );

  assert.deepEqual(rect, { x: 25, y: 18, width: 30, height: 20 });
  assert.deepEqual(moveCropRect(rect, { x: 20, y: 20 }, { width: 60, height: 40 }), {
    x: 30,
    y: 20,
    width: 30,
    height: 20,
  });
});

test("resizeCropRectFromHandle resizes from a corner while the opposite corner stays anchored", () => {
  const rect = resizeCropRectFromHandle(
    { x: 20, y: 10, width: 40, height: 30 },
    "se",
    { x: 80, y: 50 },
    "free",
    { width: 100, height: 80 }
  );

  assert.deepEqual(rect, { x: 20, y: 10, width: 60, height: 40 });
});

test("resizeCropRectFromHandle applies aspect ratios when resizing from a corner", () => {
  const rect = resizeCropRectFromHandle(
    { x: 20, y: 10, width: 40, height: 30 },
    "nw",
    { x: 4, y: 2 },
    "1:1",
    { width: 100, height: 80 }
  );

  assert.deepEqual(rect, { x: 22, y: 2, width: 38, height: 38 });
});

test("getPixelColor returns the RGBA color at a point", () => {
  const pixels = new Uint8ClampedArray([
    10, 20, 30, 255, 100, 110, 120, 255,
    200, 210, 220, 255, 1, 2, 3, 255,
  ]);

  assert.deepEqual(getPixelColor(pixels, 2, 2, 1, 0), [100, 110, 120, 255]);
});

test("removeBackgroundPixels makes colors within tolerance transparent", () => {
  const pixels = new Uint8ClampedArray([
    250, 250, 250, 255,
    245, 248, 250, 255,
    20, 30, 40, 255,
  ]);

  const result = removeBackgroundPixels(pixels, [250, 250, 250, 255], 10);

  assert.deepEqual(Array.from(result), [
    250, 250, 250, 0,
    245, 248, 250, 0,
    20, 30, 40, 255,
  ]);
  assert.notEqual(result, pixels);
});

test("removeConnectedBackgroundPixels only removes matching colors connected to the seed", () => {
  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255, 10, 10, 10, 255, 255, 255, 255, 255,
    252, 252, 252, 255, 10, 10, 10, 255, 250, 250, 250, 255,
    255, 255, 255, 255, 10, 10, 10, 255, 255, 255, 255, 255,
  ]);

  const result = removeConnectedBackgroundPixels(pixels, 3, 3, [{ x: 0, y: 0 }], 12);

  assert.equal(result[3], 0);
  assert.equal(result[15], 0);
  assert.equal(result[27], 0);
  assert.equal(result[11], 255);
  assert.equal(result[23], 255);
  assert.equal(result[35], 255);
});

test("crop rectangles remain simple serializable objects", () => {
  const rect: CropRect = { x: 1, y: 2, width: 3, height: 4 };
  assert.equal(JSON.stringify(rect), "{\"x\":1,\"y\":2,\"width\":3,\"height\":4}");
});
