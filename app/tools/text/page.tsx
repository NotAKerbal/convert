import type { Metadata } from "next";
import { TextTool } from "../../../src/components/TextTool";
import { ToolPage } from "../../../src/components/ToolPage";

export const metadata: Metadata = {
  title: "Text tools",
  description:
    "Count words and characters, change case, and clean up whitespace locally.",
};

export default function TextPage() {
  return (
    <ToolPage slug="text">
      <TextTool />
    </ToolPage>
  );
}
