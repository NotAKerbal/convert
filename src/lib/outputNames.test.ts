import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { uniquifyOutputNames } from "./outputNames.ts";

test("ZIP downloads preserve every payload when duplicate names collide with existing suffixes", async () => {
  const inputs = [
    { name: "photo.jpg", bytes: new Uint8Array([1]) },
    { name: "photo.jpg", bytes: new Uint8Array([2]) },
    { name: "photo-2.jpg", bytes: new Uint8Array([3]) },
    { name: "photo.jpg", bytes: new Uint8Array([4]) },
    { name: "README", bytes: new Uint8Array([5]) },
    { name: "README", bytes: new Uint8Array([6]) },
    { name: "README-2", bytes: new Uint8Array([7]) },
  ];
  const outputs = uniquifyOutputNames(inputs);
  const zip = new JSZip();
  for (const file of outputs) zip.file(file.name, file.bytes);
  const archive = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(Object.keys(archive.files).length, inputs.length);
  for (let i = 0; i < outputs.length; i++) {
    assert.deepEqual(await archive.file(outputs[i].name)!.async("uint8array"), inputs[i].bytes);
  }
  assert.equal(outputs[2].name, "photo-2.jpg");
  assert.equal(outputs[6].name, "README-2");
  assert.deepEqual(inputs.map((file) => file.name), [
    "photo.jpg", "photo.jpg", "photo-2.jpg", "photo.jpg", "README", "README", "README-2",
  ]);
});
