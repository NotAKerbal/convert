import type { Metadata } from "next";
import { ConverterApp } from "../../../src/components/ConverterApp";

export const metadata: Metadata = {
  title: "File converter",
  description:
    "Convert images, video, audio, documents, and more locally in your browser.",
};

export default function ConvertPage() {
  return <ConverterApp />;
}
