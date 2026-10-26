import assert from "node:assert/strict";
import test from "node:test";
import { documentFilename, escapeHtml, textToDocumentHtml } from "./documentEditor.ts";

test("plain text imports preserve lines and escape executable markup", () => {
  assert.equal(textToDocumentHtml('<script>alert("x")</script>\r\n\r\nHello & goodbye'),
    '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p><p><br></p><p>Hello &amp; goodbye</p>');
  assert.equal(escapeHtml("<a href='x'>"), "&lt;a href=&#39;x&#39;&gt;");
});

test("download names retain Unicode and cannot contain path separators", () => {
  assert.equal(documentFilename("  Notes / café: today?  "), "Notes - café- today-");
  assert.equal(documentFilename("..."), "Untitled document");
  assert.equal(documentFilename(""), "Untitled document");
  assert.equal(documentFilename("x".repeat(200)).length, 120);
});
