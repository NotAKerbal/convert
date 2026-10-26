import type { Metadata } from "next";
import { JsonTool } from "../../../src/components/JsonTool";
import { ToolPage } from "../../../src/components/ToolPage";

export const metadata: Metadata = {
  title: "JSON formatter",
  description: "Validate, pretty-print, and minify JSON in your browser.",
};

export default function JsonPage() {
  return (
    <ToolPage slug="json">
      <JsonTool />
    </ToolPage>
  );
}
