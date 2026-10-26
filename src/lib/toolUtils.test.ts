import assert from "node:assert/strict";
import test from "node:test";
import { buildQrPayload, getTextStats } from "./toolUtils.ts";

const fields = {
  url: "",
  text: "",
  ssid: "",
  password: "",
  security: "WPA",
  hidden: false,
  email: "",
  subject: "",
  message: "",
};

test("QR website input requires a complete HTTP(S) URL", () => {
  assert.equal(
    buildQrPayload("url", { ...fields, url: " https://example.com/a?b=c " })
      .value,
    "https://example.com/a?b=c",
  );
  for (const url of [
    "example.com",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ]) {
    assert.ok(buildQrPayload("url", { ...fields, url }).error);
  }
  assert.deepEqual(buildQrPayload("url", fields), { value: "", error: "" });
});

test("QR text preserves intentional whitespace and Unicode", () => {
  assert.equal(
    buildQrPayload("text", { ...fields, text: " Hello\nworld 🌎 " }).value,
    " Hello\nworld 🌎 ",
  );
  assert.equal(buildQrPayload("text", { ...fields, text: "  \n " }).value, "");
});

test("Wi-Fi QR payload escapes delimiters and omits open-network passwords", () => {
  const wifi = buildQrPayload("wifi", {
    ...fields,
    ssid: 'Cafe;"Guest"',
    password: "a:b\\c,d",
    hidden: true,
  });
  assert.equal(
    wifi.value,
    'WIFI:T:WPA;S:Cafe\\;\\"Guest\\";P:a\\:b\\\\c\\,d;H:true;;',
  );
  assert.equal(
    buildQrPayload("wifi", {
      ...fields,
      ssid: "Guest",
      security: "nopass",
      password: "old-password",
    }).value,
    "WIFI:T:nopass;S:Guest;P:;H:false;;",
  );
});

test("email QR payload encodes content so it cannot introduce extra mail fields", () => {
  const result = buildQrPayload("email", {
    ...fields,
    email: "hello@example.com",
    subject: "Hello & goodbye",
    message: "line 1\nline 2?bcc=test",
  });
  assert.equal(
    result.value,
    "mailto:hello@example.com?subject=Hello%20%26%20goodbye&body=line%201%0Aline%202%3Fbcc%3Dtest",
  );
  assert.ok(
    buildQrPayload("email", {
      ...fields,
      email: "hello@example.com?bcc=other@example.com",
    }).error,
  );
});

test("text counts empty input, paragraphs, and Unicode code points", () => {
  assert.deepEqual(getTextStats(""), {
    words: 0,
    characters: 0,
    sentences: 0,
    paragraphs: 0,
  });
  assert.deepEqual(getTextStats("Hello 🌎!\n\nNext line."), {
    words: 4,
    characters: 20,
    sentences: 2,
    paragraphs: 2,
  });
});
