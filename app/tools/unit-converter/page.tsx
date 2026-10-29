import type { Metadata } from "next";
import { ToolPage } from "../../../src/components/ToolPage";
import { UnitConverter } from "../../../src/components/UnitConverter";

export const metadata: Metadata = {
  title: "Unit converter",
  description:
    "Convert length, temperature, cooking volumes, data sizes, fuel economy, and more with exact, sourced definitions.",
};

export default function UnitConverterPage() {
  return (
    <ToolPage slug="unit-converter" compact showDescription={false}>
      <UnitConverter />
    </ToolPage>
  );
}
