import type { Metadata } from "next";
import { QrCodeTool } from "../../../src/components/QrCodeTool";
import { ToolPage } from "../../../src/components/ToolPage";

export const metadata: Metadata = {
  title: "QR code generator",
  description:
    "Create QR codes for links, text, Wi-Fi, and email, with PNG and SVG downloads.",
};

export default function QrCodePage() {
  return (
    <ToolPage slug="qr-code" compact>
      <QrCodeTool />
    </ToolPage>
  );
}
