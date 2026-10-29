import assert from "node:assert/strict";
import test from "node:test";
import {
  batchToCsv,
  convert,
  convertBatch,
  convertNumber,
  describeUnit,
  editableValue,
  formatComposite,
  formatMagnitude,
  getCategory,
  parseConversionQuery,
  parseNumber,
  popularConversions,
  rational,
  rationalEquals,
  resolveUnits,
  searchUnits,
  selectionFromSearch,
  selectionToSearch,
  toBaseMagnitude,
  unitCategories,
  unitCount,
  unitSources,
  type Magnitude,
} from "./unitConversion.ts";

const exact = (categoryId: string, from: string, to: string, input: string) => {
  const parsed = parseNumber(input);
  assert.ok(parsed.ok, input);
  const result = convert(categoryId, from, to, parsed.value);
  assert.ok(result.ok, `${input} ${from} → ${to}`);
  return formatMagnitude(result.value, {
    notation: "decimal",
    precision: 30,
    grouping: false,
  });
};
const close = (actual: number, expected: number, relative = 1e-12) =>
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * relative,
    `${actual} ≉ ${expected}`,
  );
const errorOf = (categoryId: string, from: string, to: string, input: string) => {
  const parsed = parseNumber(input);
  assert.ok(parsed.ok);
  const result = convert(categoryId, from, to, parsed.value);
  assert.equal(result.ok, false);
  return result.ok ? "" : result.error;
};

test("registry is large, consistent, and sourced", () => {
  assert.ok(unitCategories.length >= 20);
  assert.ok(unitCount() >= 200);
  for (const category of unitCategories) {
    const ids = category.units.map((unit) => unit.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${category.id}`);
    const symbols = category.units.map((unit) => unit.symbol);
    assert.equal(new Set(symbols).size, symbols.length, `duplicate symbols in ${category.id}`);
    const base = category.units.find((unit) => unit.id === category.baseUnit);
    assert.ok(base, `${category.id} base`);
    assert.equal(base.kind, "linear");
    assert.ok(rationalEquals(base.factor.value, rational(1n)));
    for (const id of [category.defaultFrom, category.defaultTo, ...category.presets.flat(), ...(category.composites ?? []).flat()])
      assert.ok(ids.includes(id), `${category.id} references ${id}`);
    for (const unit of category.units) {
      assert.ok(unit.source in unitSources, `${unit.id} source`);
      assert.ok(describeUnit(category, unit).length > 0);
      if (unit.kind !== "linear") assert.ok(unit.definition, `${unit.id} needs a definition`);
    }
  }
  for (const preset of popularConversions) {
    const category = getCategory(preset.category);
    assert.ok(category?.units.some((unit) => unit.id === preset.from));
    assert.ok(category?.units.some((unit) => unit.id === preset.to));
  }
});

test("every unit symbol resolves back to itself", () => {
  for (const category of unitCategories)
    for (const unit of category.units) {
      const resolved = resolveUnits([unit.symbol], category.id);
      assert.ok(resolved.ok, `${unit.symbol}: ${resolved.ok ? "" : resolved.error}`);
      assert.equal(resolved.units[0], unit, `${category.id}:${unit.symbol}`);
    }
});

test("every unit round-trips through the base unit exactly", () => {
  const sample = rational(37n, 8n);
  for (const category of unitCategories)
    for (const unit of category.units) {
      const base = toBaseMagnitude(category, unit, { value: sample, exact: true });
      assert.ok(base.ok, `${category.id}:${unit.id}`);
      const back = convert(category.id, category.baseUnit, unit.id, base.value);
      assert.ok(back.ok);
      assert.ok(rationalEquals(back.value.value, sample), `${category.id}:${unit.id}`);
    }
});

test("international customary definitions are exact", () => {
  assert.equal(exact("length", "mi", "m", "1").plain, "1609.344");
  assert.equal(exact("length", "in", "cm", "1").plain, "2.54");
  assert.equal(exact("length", "ft", "in", "1").plain, "12");
  assert.equal(exact("length", "nmi", "m", "1").plain, "1852");
  assert.equal(exact("length", "ft_us", "m", "3937").plain, "1200");
  assert.equal(exact("length", "pt", "in", "72").plain, "1");
  assert.equal(exact("length", "ly", "m", "1").plain, "9460730472580800");
  assert.equal(exact("length", "au", "m", "1").plain, "149597870700");
  close(convertNumber("length", "pc", "m", "1"), 3.0856775814913673e16);
  assert.equal(exact("mass", "lb", "kg", "1").plain, "0.45359237");
  assert.equal(exact("mass", "oz", "g", "1").plain, "28.349523125");
  assert.equal(exact("mass", "gr", "mg", "1").plain, "64.79891");
  assert.equal(exact("mass", "ozt", "g", "1").plain, "31.1034768");
  assert.equal(exact("mass", "st", "lb", "1").plain, "14");
  assert.equal(exact("area", "acre", "m2", "1").plain, "4046.8564224");
  assert.equal(exact("area", "ha", "acre", "1").exact, false);
});

test("US, imperial, and cooking volumes stay distinct", () => {
  assert.equal(exact("volume", "gal_us", "L", "1").plain, "3.785411784");
  assert.equal(exact("volume", "gal_imp", "L", "1").plain, "4.54609");
  assert.equal(exact("volume", "cup_us", "mL", "1").plain, "236.5882365");
  assert.equal(exact("volume", "cup_legal", "mL", "1").plain, "240");
  assert.equal(exact("volume", "cup_metric", "mL", "1").plain, "250");
  assert.equal(exact("volume", "floz_us", "mL", "1").plain, "29.5735295625");
  assert.equal(exact("volume", "floz_imp", "mL", "1").plain, "28.4130625");
  assert.equal(exact("volume", "tbsp_us", "tsp_us", "1").plain, "3");
  assert.equal(exact("volume", "tbsp_us", "mL", "1").plain, "14.78676478125");
  assert.equal(exact("volume", "pt_imp", "floz_imp", "1").plain, "20");
  assert.equal(exact("volume", "pt_us", "floz_us", "1").plain, "16");
  assert.equal(exact("volume", "bu_us", "L", "1").plain, "35.23907016688");
  assert.equal(exact("volume", "drypt_us", "L", "1").plain, "0.5506104713575");
  assert.equal(exact("volume", "bbl_oil", "gal_us", "1").plain, "42");
  assert.ok(!getCategory("mass")!.units.some((unit) => /cup|spoon/.test(unit.name)));
});

test("temperature scales use offsets and reject values below absolute zero", () => {
  assert.equal(exact("temperature", "degF", "degC", "98.6").plain, "37");
  assert.equal(exact("temperature", "degC", "degF", "-40").plain, "-40");
  assert.equal(exact("temperature", "degC", "K", "0").plain, "273.15");
  assert.equal(exact("temperature", "degF", "degR", "0").plain, "459.67");
  assert.equal(exact("temperature", "K", "degF", "0").plain, "-459.67");
  assert.equal(exact("temperature", "degC", "K", "-273.15").plain, "0");
  assert.match(errorOf("temperature", "degC", "degF", "-273.16"), /absolute zero/);
  assert.match(errorOf("temperature", "degF", "K", "-500"), /absolute zero/);
  assert.match(errorOf("temperature", "K", "degC", "-0.001"), /absolute zero/);
  // Differences have no offset and may be negative.
  assert.equal(exact("temperature-difference", "ddegC", "ddegF", "10").plain, "18");
  assert.equal(exact("temperature-difference", "ddegF", "dK", "-9").plain, "-5");
});

test("fuel economy converts reciprocally and rejects zero or negative values", () => {
  close(convertNumber("fuel-economy", "mpg_us", "L/100km", "30"), 7.840486111111111);
  close(convertNumber("fuel-economy", "L/100km", "mpg_us", "7.840486111111111"), 30);
  close(convertNumber("fuel-economy", "mpg_imp", "mpg_us", "1"), 0.8326741846, 1e-9);
  close(convertNumber("fuel-economy", "L/100km", "km/L", "5"), 20);
  close(convertNumber("fuel-economy", "gal_us/100mi", "mpg_us", "4"), 25);
  assert.equal(exact("fuel-economy", "L/100km", "km/L", "8").plain, "12.5");
  assert.match(errorOf("fuel-economy", "L/100km", "mpg_us", "0"), /no finite/);
  assert.match(errorOf("fuel-economy", "mpg_us", "L/100km", "0"), /greater than zero/);
  assert.match(errorOf("fuel-economy", "mpg_us", "L/100km", "-5"), /greater than zero/);
});

test("engineering units follow NIST SP 811 values", () => {
  close(convertNumber("pressure", "psi", "Pa", "1"), 6894.757293168361);
  assert.equal(exact("pressure", "mmHg", "Pa", "1").plain, "133.322387415");
  close(convertNumber("pressure", "inHg", "Pa", "1"), 3386.389, 2e-7);
  close(convertNumber("pressure", "Torr", "Pa", "760"), 101325);
  assert.equal(exact("pressure", "inH2O", "Pa", "1").plain, "249.08891");
  assert.equal(exact("force", "lbf", "N", "1").plain, "4.4482216152605");
  assert.equal(exact("force", "kgf", "N", "1").plain, "9.80665");
  assert.equal(exact("energy", "Btu", "J", "1").plain, "1055.05585262");
  assert.equal(exact("energy", "kWh", "MJ", "1").plain, "3.6");
  assert.equal(exact("energy", "kcal_th", "kJ", "1").plain, "4.184");
  assert.equal(exact("energy", "eV", "J", "1").plain, "0.0000000000000000001602176634");
  assert.equal(exact("energy", "ftlbf", "J", "1").plain, "1.3558179483314004");
  assert.equal(exact("power", "hp", "W", "1").plain, "745.69987158227022");
  assert.equal(exact("power", "PS", "W", "1").plain, "735.49875");
  close(convertNumber("power", "TR", "W", "1"), 3516.8528420667);
  assert.equal(exact("torque", "lbf·ft", "N·m", "1").plain, "1.3558179483314004");
  assert.equal(exact("specific-energy", "Btu/lb", "kJ/kg", "1").plain, "2.326");
  close(convertNumber("charge", "F_charge", "C", "1"), 96485.33212331001);
  close(convertNumber("current", "statA", "A", "1"), 3.3356409519815204e-10);
  close(convertNumber("voltage", "statV", "V", "1"), 299.792458);
  close(convertNumber("illuminance", "fc", "lx", "1"), 10.763910416709722);
  assert.equal(exact("radioactivity", "Ci", "GBq", "1").plain, "37");
  assert.equal(exact("speed", "kn", "km/h", "1").plain, "1.852");
  assert.equal(exact("speed", "mph", "km/h", "1").plain, "1.609344");
  assert.equal(exact("acceleration", "g0", "ft/s2", "1").exact, false);
});

test("angles involve π and are marked approximate", () => {
  const halfTurn = convert("angle", "deg", "rad", rational(180n));
  assert.ok(halfTurn.ok);
  assert.equal(halfTurn.value.exact, false);
  close(convertNumber("angle", "deg", "rad", "180"), Math.PI);
  assert.equal(exact("angle", "deg", "grad", "90").plain, "100");
  assert.equal(exact("angle", "turn", "deg", "1").plain, "360");
  close(convertNumber("angular-velocity", "rpm", "rad/s", "60"), 2 * Math.PI);
});

test("digital storage keeps SI and IEC prefixes separate", () => {
  assert.equal(exact("data-storage", "kB", "B", "1").plain, "1000");
  assert.equal(exact("data-storage", "KiB", "B", "1").plain, "1024");
  assert.equal(exact("data-storage", "B", "bit", "1").plain, "8");
  assert.equal(exact("data-storage", "TB", "GiB", "1").plain, "931.322574615478515625");
  assert.equal(exact("data-storage", "GiB", "MB", "1").plain, "1073.741824");
  assert.equal(exact("data-storage", "QB", "B", "1").plain, "1" + "0".repeat(30));
  assert.equal(exact("data-rate", "Mbit/s", "MB/s", "100").plain, "12.5");
  assert.equal(exact("data-rate", "MiB/s", "Mbit/s", "1").plain, "8.388608");
});

test("number parsing supports fractions and scientific notation without eval", () => {
  const value = (text: string) => {
    const parsed = parseNumber(text);
    assert.ok(parsed.ok, text);
    return formatMagnitude({ value: parsed.value, exact: true }, { notation: "decimal", precision: 30, grouping: false }).plain;
  };
  assert.equal(value("3/4"), "0.75");
  assert.equal(value("1 1/2"), "1.5");
  assert.equal(value("-1 1/2"), "-1.5");
  assert.equal(value("2½"), "2.5");
  assert.equal(value("⅜"), "0.375");
  assert.equal(value("1,234,567.5"), "1234567.5");
  assert.equal(value("1_000"), "1000");
  assert.equal(value(".25"), "0.25");
  assert.equal(value("5."), "5");
  assert.equal(value("+7"), "7");
  assert.equal(value("−3"), "-3");
  assert.equal(value("6.02e23"), "602000000000000000000000");
  assert.equal(value("1.5E-3"), "0.0015");
  assert.equal(value("1.5 × 10^3"), "1500");
  assert.equal(value("2x10⁻²"), "0.02");
  assert.equal(value("1e-3/4"), "0.00025");
  for (const bad of ["", "abc", "1/0", "1 2", "--1", "1..2", "Infinity", "NaN", "1e5000", "1,5", "2^3", "alert(1)", "1+1", "0x10"]) {
    const parsed = parseNumber(bad);
    assert.equal(parsed.ok, false, bad);
  }
  const comma = parseNumber("1,5");
  assert.ok(!comma.ok && /period for decimals/.test(comma.error));
  const zero = parseNumber("3/0");
  assert.ok(!zero.ok && /denominator/.test(zero.error));
  const huge = parseNumber("1e1001");
  assert.ok(!huge.ok && /exponent/.test(huge.error));
});

test("formatting honors precision and notation choices", () => {
  const third: Magnitude = { value: rational(1n, 3n), exact: true };
  assert.deepEqual(formatMagnitude(third, { notation: "auto", precision: 4, grouping: true }), { text: "0.3333", plain: "0.3333", exact: false });
  const big: Magnitude = { value: rational(1234567n), exact: true };
  assert.equal(formatMagnitude(big, { notation: "auto", precision: 10, grouping: true }).text, "1,234,567");
  assert.equal(formatMagnitude(big, { notation: "auto", precision: 10, grouping: true }).exact, true);
  assert.equal(formatMagnitude(big, { notation: "auto", precision: 10, grouping: false }).text, "1234567");
  assert.deepEqual(formatMagnitude(big, { notation: "scientific", precision: 3, grouping: true }), { text: "1.23 × 10⁶", plain: "1.23e6", exact: false });
  assert.equal(formatMagnitude(big, { notation: "engineering", precision: 4, grouping: true }).plain, "1.235e6");
  assert.equal(formatMagnitude({ value: rational(12345n, 1000000n), exact: true }, { notation: "engineering", precision: 3, grouping: true }).plain, "12.3e-3");
  assert.equal(formatMagnitude(big, { notation: "fixed", precision: 2, grouping: true }).text, "1,234,567.00");
  assert.equal(formatMagnitude({ value: rational(-1n, 1000n), exact: true }, { notation: "fixed", precision: 2, grouping: true }).plain, "0.00");
  assert.equal(formatMagnitude({ value: rational(-5n, 2n), exact: true }, defaultish()).text, "−2.5");
  assert.equal(formatMagnitude({ value: rational(999999n, 1000000n), exact: true }, { notation: "auto", precision: 3, grouping: true }).text, "1");
  assert.equal(formatMagnitude({ value: rational(1n, 10n ** 9n), exact: true }, defaultish()).plain, "1e-9");
  assert.equal(formatMagnitude({ value: rational(10n ** 15n), exact: true }, defaultish()).plain, "1e15");
  // Values involving π are never presented as exact.
  assert.equal(formatMagnitude({ value: rational(1n), exact: false }, defaultish()).exact, false);
  assert.equal(editableValue({ value: rational(1250n, 381n), exact: true }), "3.28083989501312");
});

function defaultish() {
  return { notation: "auto" as const, precision: 10, grouping: true };
}

test("composite outputs carry without rounding errors", () => {
  const length = getCategory("length")!;
  const inches = (value: Magnitude) => toBaseMagnitude(length, length.units.find((unit) => unit.id === "in")!, value);
  const base = inches({ value: rational(719999n, 10000n), exact: true });
  assert.ok(base.ok);
  assert.equal(formatComposite(length, ["ft", "in"], base.value)?.text, "6 ft 0 in");
  const height = inches({ value: rational(70n), exact: true });
  assert.ok(height.ok);
  assert.deepEqual(formatComposite(length, ["ft", "in"], height.value), { text: "5 ft 10 in", plain: "5 ft 10 in", exact: true });
  const time = getCategory("time")!;
  const seconds = toBaseMagnitude(time, time.units.find((unit) => unit.id === "s")!, { value: rational(90061n), exact: true });
  assert.ok(seconds.ok);
  assert.equal(formatComposite(time, ["d", "h", "min", "s"], seconds.value)?.text, "1 d 1 h 1 min 1 s");
  const small = toBaseMagnitude(time, time.units.find((unit) => unit.id === "s")!, { value: rational(-45n), exact: true });
  assert.ok(small.ok);
  assert.equal(formatComposite(time, ["h", "min", "s"], small.value)?.text, "−45 s");
  for (const category of unitCategories)
    for (const composite of category.composites ?? [])
      assert.ok(formatComposite(category, composite, { value: rational(1n), exact: true }), `${category.id} ${composite}`);
});

test("typed queries resolve units, mixed values, and ambiguity", () => {
  const read = (text: string) => {
    const result = parseConversionQuery(text);
    assert.ok(result.ok && result.kind === "quantity", `${text}: ${result.ok ? result.kind : result.error}`);
    return result;
  };
  const value = (text: string) => {
    const result = read(text);
    assert.ok(result.result, text);
    return formatMagnitude(result.result, { notation: "decimal", precision: 30, grouping: false }).plain;
  };
  assert.equal(value("5 ft 3 in to cm"), "160.02");
  assert.equal(value("5'3\" to cm"), "160.02");
  assert.equal(value("5ft to m"), "1.524");
  assert.equal(value("12 in in cm"), "30.48");
  assert.equal(value("98.6 °F to °C"), "37");
  assert.equal(value("98.6 F in C"), "37");
  assert.equal(value("212 fahrenheit -> celsius"), "100");
  assert.equal(value("1 1/2 US cups to mL"), "354.88235475");
  assert.equal(value("2 lb 4 oz to kg"), "1.0205828325");
  assert.equal(value("100 Mbps to MB/s"), "12.5");
  assert.equal(value("1 GiB → MiB"), "1024");
  assert.equal(value("3 kilometres to metres"), "3000");
  assert.equal(value("2 feet to inches"), "24");
  assert.equal(value("10 pounds per square inch to kPa").slice(0, 8), "68.94757");
  assert.equal(value("1.5e3 m to km"), "1.5");
  assert.equal(value("5 µm to nm"), "5000");
  assert.equal(value("5 um to nm"), "5000");
  assert.equal(value("3 g to m/s²").slice(0, 7), "29.4199");
  assert.equal(read("5 ft 3 in").from.id, "in");
  assert.equal(read("5 ft 3 in").combined, true);
  const failures: [string, RegExp][] = [
    ["1 gal to L", /US gallon.*imperial gallon/],
    ["1 cup to mL", /could mean/],
    ["30 mpg to L/100 km", /could mean/],
    ["5 KB to B", /kB or KiB/],
    ["10 kg to m", /Can't convert/],
    ["5 florps to m", /Unknown unit/],
    ["-300 °C to K", /absolute zero/],
    ["0 L/100 km to mpg (US)", /no finite|greater than zero/],
    ["5 °C 3 K to °F", /simple units/],
    ["abc", /isn't a number/],
    ["5 to m", /Add a unit/],
  ];
  for (const [text, pattern] of failures) {
    const result = parseConversionQuery(text);
    assert.ok(!result.ok, text);
    assert.match(result.error, pattern, text);
  }
  const number = parseConversionQuery("42");
  assert.ok(number.ok && number.kind === "number");
});

test("batch conversion handles numbers, unit lines, and errors", () => {
  const { rows, truncated } = convertBatch(
    "1\n\n2.5\n5 ft 3 in\n12 psi to kPa\nnope\n-500",
    { category: "length", from: "ft", to: "m" },
  );
  assert.equal(truncated, false);
  assert.deepEqual(rows.map((row) => row.line), [1, 3, 4, 5, 6, 7]);
  assert.equal(rows[0].result?.plain, "0.3048");
  assert.equal(rows[1].result?.plain, "0.762");
  assert.equal(rows[2].result?.plain, "1.6002");
  assert.equal(rows[2].to?.id, "m");
  assert.equal(rows[3].to?.id, "kPa");
  assert.equal(rows[4].ok, false);
  assert.equal(rows[5].result?.plain, "-152.4");
  const temperatures = convertBatch("-500\n32", { category: "temperature", from: "degF", to: "degC" });
  assert.match(temperatures.rows[0].error!, /absolute zero/);
  assert.equal(temperatures.rows[1].result?.plain, "0");
  const many = convertBatch(Array.from({ length: 2100 }, () => "1").join("\n"), { category: "length", from: "m", to: "ft" });
  assert.equal(many.rows.length, 2000);
  assert.equal(many.truncated, true);
});

test("CSV export escapes cells and neutralizes formulas", () => {
  const { rows } = convertBatch('1\n=HYPERLINK("x")\n-5\n"quoted, text"', { category: "length", from: "m", to: "ft" });
  const csv = batchToCsv(rows);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "Line,Input,Value,From unit,Result,To unit,Exact,Error");
  assert.match(lines[1], /^1,1,1,m,3\.280839895,ft,no,$/);
  assert.match(lines[2], /^2,"'=HYPERLINK\(""x""\)",/);
  assert.match(lines[3], /^3,'-5,-5,m,-16\.40419948,ft,no,$/);
  assert.match(lines[4], /^4,"""quoted, text""",/);
  assert.ok(csv.endsWith("\r\n"));
});

test("search finds categories and units by name, symbol, and alias", () => {
  const ids = (query: string) => searchUnits(query).map((result) => `${result.category.id}:${result.unit?.id ?? ""}`);
  assert.equal(ids("psi")[0], "pressure:psi");
  assert.equal(ids("kelvin")[0], "temperature:K");
  assert.ok(ids("cup").includes("volume:cup_us"));
  assert.ok(ids("fuel").includes("fuel-economy:"));
  assert.ok(ids("gibibyte").includes("data-storage:GiB"));
  assert.deepEqual(ids("   "), []);
});

test("share links validate their state", () => {
  const search = selectionToSearch({ category: "volume", from: "cup_us", to: "mL", value: "1 1/2" });
  assert.equal(search, "?category=volume&from=cup_us&to=mL&value=1+1%2F2");
  assert.deepEqual(selectionFromSearch(search), { category: "volume", from: "cup_us", to: "mL", value: "1 1/2" });
  assert.deepEqual(selectionFromSearch("?category=length&from=nope&to=m"), { category: "length", from: "ft", to: "m" });
  assert.deepEqual(selectionFromSearch("?category=__proto__"), {});
  assert.deepEqual(selectionFromSearch("?category=length&from=m&to=ft&value=" + "9".repeat(500)), { category: "length", from: "m", to: "ft" });
});

test("shared swaps preserve rational precision and approximation provenance", () => {
  for (const exact of [true, false]) {
    const retained = { value: rational(1250n, 1143n), exact };
    const selection = {
      category: "length", from: "ft", to: "m",
      value: editableValue(retained), retained,
    };
    assert.deepEqual(selectionFromSearch(selectionToSearch(selection)), selection);
  }
  const base = "?category=length&from=ft&to=m&value=1";
  for (const invalid of ["&n=1&d=0", "&n=invalid&d=1", "&n=2&d=1", `&n=${"1".repeat(2501)}&d=1`]) {
    assert.equal(selectionFromSearch(base + invalid).retained, undefined);
  }
});
