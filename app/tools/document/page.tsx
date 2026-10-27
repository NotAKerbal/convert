import type { Metadata } from "next";
import { DocumentEditor } from "../../../src/components/DocumentEditor";
import { ToolPage } from "../../../src/components/ToolPage";

export const metadata: Metadata = {
  title: "Document editor",
  description:
    "Write and format documents in your browser, save a local draft, and export HTML, plain text, or print to PDF.",
};

export default function DocumentPage() {
  return (
    <ToolPage slug="document">
      <DocumentEditor />
    </ToolPage>
  );
}
