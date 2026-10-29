// Unit conversion engine.
//
// Every factor is an exact rational (BigInt numerator/denominator) built from
// the published definition of the unit, so conversions such as
// 1 mi = 1609.344 m stay exact. Only units whose definition involves π (angles,
// parsec, circular mil) are marked inexact; π is carried to 50 digits.
//
// Primary references are listed in `unitSources` and attached to each unit.

export type Rational = { readonly n: bigint; readonly d: bigint };
export type Magnitude = { readonly value: Rational; readonly exact: boolean };

// ---------------------------------------------------------------------------
// Rational arithmetic

const ZERO_R: Rational = { n: 0n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function rational(n: bigint, d: bigint = 1n): Rational {
  if (d === 0n) throw new RangeError("Division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

const add = (a: Rational, b: Rational) =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) =>
  rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n);
const cmp = (a: Rational, b: Rational) => {
  const diff = a.n * b.d - b.n * a.d;
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
};
const pow10 = (k: number) => 10n ** BigInt(k);

export function rationalEquals(a: Rational, b: Rational) {
  return a.n === b.n && a.d === b.d;
}

export function rationalToNumber(r: Rational): number {
  return Number(r.n) / Number(r.d);
}

/** Parses an exact decimal constant such as "0.3048" or "1.602176634e-19". */
function decimal(text: string): Rational {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match) throw new Error(`Bad constant ${text}`);
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  let n = BigInt(whole + fraction) * (sign ? -1n : 1n);
  let d = pow10(fraction.length);
  const e = Number(exponent);
  if (e >= 0) n *= pow10(e);
  else d *= pow10(-e);
  return rational(n, d);
}

// ---------------------------------------------------------------------------
// Magnitudes used to build unit factors

const ex = (text: string): Magnitude => ({ value: decimal(text), exact: true });
const frac = (n: bigint, d: bigint): Magnitude => ({
  value: rational(n, d),
  exact: true,
});
const times = (...parts: Magnitude[]): Magnitude =>
  parts.reduce(
    (product, part) => ({
      value: mul(product.value, part.value),
      exact: product.exact && part.exact,
    }),
    ONE,
  );
const per = (a: Magnitude, b: Magnitude): Magnitude => ({
  value: div(a.value, b.value),
  exact: a.exact && b.exact,
});
const power = (a: Magnitude, k: number) =>
  times(...Array.from({ length: k }, () => a));
const tenTo = (k: number): Magnitude =>
  k >= 0 ? frac(pow10(k), 1n) : frac(1n, pow10(-k));

const ONE: Magnitude = { value: rational(1n), exact: true };
// π to 50 decimal places. Results that depend on it are flagged approximate.
const PI: Magnitude = {
  value: decimal("3.14159265358979323846264338327950288419716939937510"),
  exact: false,
};

// Defining constants (exact by definition).
const INCH = ex("0.0254"); // 1959 international yard and pound
const FOOT = ex("0.3048");
const YARD = ex("0.9144");
const MILE = ex("1609.344");
const SURVEY_FOOT = frac(1200n, 3937n);
const NAUTICAL_MILE = ex("1852");
const POUND = ex("0.45359237");
const GRAIN = per(POUND, ex("7000"));
const STANDARD_GRAVITY = ex("9.80665");
const POUND_FORCE = times(POUND, STANDARD_GRAVITY);
const US_GALLON = times(ex("231"), power(INCH, 3));
const IMPERIAL_GALLON = ex("0.00454609");
const LITER = ex("0.001");
const SPEED_OF_LIGHT = ex("299792458");
const ELEMENTARY_CHARGE = ex("1.602176634e-19");
const AVOGADRO = ex("6.02214076e23");
const DAY = ex("86400");
const JULIAN_YEAR = times(ex("365.25"), DAY);
const ASTRONOMICAL_UNIT = ex("149597870700");
const CALORIE_TH = ex("4.184");
const CALORIE_IT = ex("4.1868");
const BTU_IT = ex("1055.05585262");
const HOUR = ex("3600");
const C_CGS = times(SPEED_OF_LIGHT, ex("100")); // speed of light in cm/s

// ---------------------------------------------------------------------------
// Sources

export const unitSources = {
  si: {
    label: "BIPM, The International System of Units (SI Brochure), 9th edition",
    url: "https://www.bipm.org/en/publications/si-brochure",
  },
  cgpm2022: {
    label: "27th CGPM (2022), Resolution 3: prefixes ronna, quetta, ronto, quecto",
    url: "https://www.bipm.org/en/cgpm-2022/resolution-3",
  },
  nist811: {
    label: "NIST SP 811, Appendix B.8: conversion factors",
    url: "https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8",
  },
  hb44: {
    label: "NIST Handbook 44, Appendix C: general tables of units of measurement",
    url: "https://www.nist.gov/pml/owm/nist-handbook-44-current-edition",
  },
  surveyFoot: {
    label: "Deprecation of the U.S. survey foot, 85 FR 62698 (2020)",
    url: "https://www.federalregister.gov/documents/2020/10/05/2020-21902/deprecation-of-the-united-states-us-survey-foot",
  },
  ukWma: {
    label: "UK Weights and Measures Act 1985, Schedule 1",
    url: "https://www.legislation.gov.uk/ukpga/1985/72/schedule/1",
  },
  fda: {
    label: "21 CFR 101.9(b)(5)(viii): household measures for nutrition labeling",
    url: "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.9",
  },
  iec: {
    label: "NIST: prefixes for binary multiples (IEC 80000-13)",
    url: "https://physics.nist.gov/cuu/Units/binary.html",
  },
  iau: {
    label: "IAU resolutions: 2012 B2 (astronomical unit), 2015 B2 (parsec)",
    url: "https://www.iau.org/IAU/Iau/Publications/List-of-Resolutions.aspx",
  },
  derived: {
    label: "Derived arithmetically from the referenced component units",
    url: "",
  },
  convention: {
    label: "Common convention; not a legally defined unit",
    url: "",
  },
} as const;
export type SourceId = keyof typeof unitSources;

// ---------------------------------------------------------------------------
// Unit and category definitions

export type UnitKind = "linear" | "affine" | "reciprocal";

export type UnitDefinition = {
  /** Stable identifier used in links and saved conversions. */
  id: string;
  name: string;
  symbol: string;
  group: string;
  kind: UnitKind;
  /**
   * linear: base = value × factor
   * affine: base = (value + offset) × factor
   * reciprocal: base = factor ÷ value
   */
  factor: Magnitude;
  offset?: Magnitude;
  aliases: string[];
  /** Matched case-insensitively only, at lower priority (for example "C"). */
  looseAliases: string[];
  source: SourceId;
  /** Shown instead of the generated "1 x = y base" for nonlinear units. */
  definition?: string;
  note?: string;
};

export type CategoryGroup =
  | "Everyday"
  | "Science & engineering"
  | "Electricity & magnetism"
  | "Digital"
  | "Light & radiation";

export type CategoryDefinition = {
  id: string;
  name: string;
  group: CategoryGroup;
  description: string;
  keywords: string;
  baseUnit: string;
  defaultFrom: string;
  defaultTo: string;
  units: UnitDefinition[];
  presets: [string, string][];
  notes: string[];
  /** Values must stay at or above this many base units. */
  domain?: { min: Rational; inclusive: boolean; message: string };
  /** Mixed-unit outputs such as feet + inches (largest unit first). */
  composites?: string[][];
};

type UnitSpec = {
  id: string;
  name: string;
  symbol: string;
  factor?: Magnitude;
  kind?: UnitKind;
  offset?: Magnitude;
  aliases?: string[];
  loose?: string[];
  source?: SourceId;
  definition?: string;
  note?: string;
};

type GroupSpec = { group: string; source: SourceId; units: UnitSpec[] };

const PREFIXES: Record<string, { name: string; exp: number; id: string }> = {
  Q: { name: "quetta", exp: 30, id: "Q" },
  R: { name: "ronna", exp: 27, id: "R" },
  Y: { name: "yotta", exp: 24, id: "Y" },
  Z: { name: "zetta", exp: 21, id: "Z" },
  E: { name: "exa", exp: 18, id: "E" },
  P: { name: "peta", exp: 15, id: "P" },
  T: { name: "tera", exp: 12, id: "T" },
  G: { name: "giga", exp: 9, id: "G" },
  M: { name: "mega", exp: 6, id: "M" },
  k: { name: "kilo", exp: 3, id: "k" },
  h: { name: "hecto", exp: 2, id: "h" },
  da: { name: "deca", exp: 1, id: "da" },
  d: { name: "deci", exp: -1, id: "d" },
  c: { name: "centi", exp: -2, id: "c" },
  m: { name: "milli", exp: -3, id: "m" },
  µ: { name: "micro", exp: -6, id: "u" },
  n: { name: "nano", exp: -9, id: "n" },
  p: { name: "pico", exp: -12, id: "p" },
  f: { name: "femto", exp: -15, id: "f" },
  a: { name: "atto", exp: -18, id: "a" },
};

/**
 * Generates SI-prefixed units. Templates use "{}" where the prefix goes, e.g.
 * name "square {}meter", symbol "{}m²". Without "{}" the prefix is prepended.
 */
function prefixed(
  base: { id: string; name: string; symbol: string; factor?: Magnitude },
  prefixes: string[],
  options: { power?: number; aliases?: (prefix: string) => string[] } = {},
): UnitSpec[] {
  const fill = (template: string, value: string) =>
    template.includes("{}") ? template.replace("{}", value) : value + template;
  return prefixes.map((prefix) => {
    const info = PREFIXES[prefix];
    return {
      id: fill(base.id, info.id),
      name: fill(base.name, info.name),
      symbol: fill(base.symbol, prefix),
      factor: times(base.factor ?? ONE, tenTo(info.exp * (options.power ?? 1))),
      aliases: options.aliases?.(prefix),
      source:
        Math.abs(info.exp) >= 27 ? ("cgpm2022" as const) : ("si" as const),
    };
  });
}

function category(
  spec: Omit<CategoryDefinition, "units"> & { groups: GroupSpec[] },
): CategoryDefinition {
  const { groups, ...rest } = spec;
  const units = groups.flatMap(({ group, source, units }) =>
    units.map((unit): UnitDefinition => {
      const aliases = new Set(unit.aliases ?? []);
      for (const [american, british] of [
        ["meter", "metre"],
        ["liter", "litre"],
      ])
        if (unit.name.includes(american))
          aliases.add(unit.name.replaceAll(american, british));
      if (unit.symbol.includes("µ")) aliases.add(unit.symbol.replace("µ", "u"));
      return {
        id: unit.id,
        name: unit.name,
        symbol: unit.symbol,
        group,
        kind: unit.kind ?? "linear",
        factor: unit.factor ?? ONE,
        offset: unit.offset,
        aliases: [...aliases],
        looseAliases: unit.loose ?? [],
        source: unit.source ?? source,
        definition: unit.definition,
        note: unit.note,
      };
    }),
  );
  return { ...rest, units };
}

// ---------------------------------------------------------------------------
// Categories

const m2 = power(ex("1"), 2);
const SQ_FOOT = power(FOOT, 2);
const SQ_INCH = power(INCH, 2);
const CU_INCH = power(INCH, 3);
const CU_FOOT = power(FOOT, 3);

export const unitCategories: CategoryDefinition[] = [
  category({
    id: "length",
    name: "Length",
    group: "Everyday",
    description: "Distance, height, and size — from atoms to parsecs.",
    keywords: "distance height width depth size",
    baseUnit: "m",
    defaultFrom: "ft",
    defaultTo: "m",
    presets: [
      ["ft", "m"],
      ["in", "cm"],
      ["mi", "km"],
      ["nmi", "km"],
    ],
    composites: [["ft", "in"]],
    notes: [
      "Inch, foot, yard, and mile use the 1959 international definitions (1 in = 25.4 mm exactly).",
      "The U.S. survey foot (1200/3937 m) was deprecated after 2022 and is offered only for legacy survey data.",
      "Typographic points are DTP/PostScript points (1/72 in). Screen pixels are not offered because their physical size depends on display density.",
    ],
    groups: [
      {
        group: "Metric",
        source: "si",
        units: [
          ...prefixed({ id: "m", name: "meter", symbol: "m" }, ["k"]),
          { id: "m", name: "meter", symbol: "m", aliases: ["meters"] },
          ...prefixed({ id: "m", name: "meter", symbol: "m" }, [
            "d",
            "c",
            "m",
            "µ",
            "n",
            "p",
          ]).map((unit) =>
            unit.id === "um" ? { ...unit, aliases: ["micron"] } : unit,
          ),
          {
            id: "angstrom",
            name: "ångström",
            symbol: "Å",
            factor: ex("1e-10"),
            aliases: ["angstrom", "angstroms"],
            source: "nist811",
          },
        ],
      },
      {
        group: "US customary & imperial",
        source: "hb44",
        units: [
          { id: "in", name: "inch", symbol: "in", factor: INCH, aliases: ["inches", "″", '"'] },
          { id: "ft", name: "foot", symbol: "ft", factor: FOOT, aliases: ["feet", "′", "'"] },
          { id: "yd", name: "yard", symbol: "yd", factor: YARD, aliases: ["yds"] },
          { id: "mi", name: "mile", symbol: "mi", factor: MILE, aliases: ["statute mile"] },
          {
            id: "mil",
            name: "mil (thou)",
            symbol: "mil",
            factor: times(INCH, ex("0.001")),
            aliases: ["thou", "thousandth of an inch"],
          },
          { id: "hand", name: "hand", symbol: "hh", factor: times(INCH, ex("4")) },
          { id: "fathom", name: "fathom", symbol: "ftm", factor: times(FOOT, ex("6")) },
          { id: "rod", name: "rod", symbol: "rd", factor: times(FOOT, ex("16.5")), aliases: ["pole", "perch"] },
          { id: "chain", name: "chain", symbol: "ch", factor: times(FOOT, ex("66")) },
          { id: "furlong", name: "furlong", symbol: "fur", factor: times(FOOT, ex("660")) },
        ],
      },
      {
        group: "Survey & nautical",
        source: "surveyFoot",
        units: [
          {
            id: "ft_us",
            name: "U.S. survey foot",
            symbol: "ft (US survey)",
            factor: SURVEY_FOOT,
            aliases: ["survey foot", "survey feet", "US survey ft", "ftUS"],
            note: "Legacy unit; deprecated December 31, 2022.",
          },
          {
            id: "mi_us",
            name: "U.S. survey mile",
            symbol: "mi (US survey)",
            factor: times(SURVEY_FOOT, ex("5280")),
            aliases: ["survey mile"],
            note: "Legacy unit; 5280 U.S. survey feet.",
          },
          {
            id: "nmi",
            name: "nautical mile",
            symbol: "nmi",
            factor: NAUTICAL_MILE,
            aliases: ["NM", "international nautical mile"],
            source: "nist811",
          },
        ],
      },
      {
        group: "Typography",
        source: "nist811",
        units: [
          {
            id: "pt",
            name: "point (DTP)",
            symbol: "pt",
            factor: per(INCH, ex("72")),
            aliases: ["point", "points", "PostScript point"],
          },
          { id: "pica", name: "pica (DTP)", symbol: "pica", factor: per(INCH, ex("6")), aliases: ["picas"] },
          { id: "twip", name: "twip", symbol: "twip", factor: per(INCH, ex("1440")), source: "convention", note: "1/20 point, used by word processors." },
        ],
      },
      {
        group: "Astronomical",
        source: "iau",
        units: [
          {
            id: "au",
            name: "astronomical unit",
            symbol: "au",
            factor: ASTRONOMICAL_UNIT,
            aliases: ["AU", "ua"],
          },
          {
            id: "ly",
            name: "light-year",
            symbol: "ly",
            factor: times(SPEED_OF_LIGHT, JULIAN_YEAR),
            aliases: ["light year", "light years"],
            note: "Distance light travels in vacuum in one Julian year (365.25 days).",
          },
          {
            id: "pc",
            name: "parsec",
            symbol: "pc",
            factor: per(times(ASTRONOMICAL_UNIT, ex("648000")), PI),
            note: "Exactly 648 000/π au.",
          },
          {
            id: "kpc",
            name: "kiloparsec",
            symbol: "kpc",
            factor: per(times(ASTRONOMICAL_UNIT, ex("648000000")), PI),
          },
          {
            id: "Mpc",
            name: "megaparsec",
            symbol: "Mpc",
            factor: per(times(ASTRONOMICAL_UNIT, ex("648000000000")), PI),
          },
        ],
      },
    ],
  }),
  category({
    id: "mass",
    name: "Mass",
    group: "Everyday",
    description: "Weight on the scale, recipes by weight, and precious metals.",
    keywords: "weight heavy scale body weight kitchen scale",
    baseUnit: "kg",
    defaultFrom: "lb",
    defaultTo: "kg",
    presets: [
      ["lb", "kg"],
      ["oz", "g"],
      ["st", "kg"],
      ["ozt", "g"],
    ],
    composites: [
      ["lb", "oz"],
      ["st", "lb"],
    ],
    notes: [
      "Pound and ounce are avoirdupois units (1 lb = 0.453 592 37 kg exactly). Troy ounces are for precious metals.",
      "Volume-to-mass conversions (such as cups of flour to grams) depend on each ingredient's density, so they are intentionally not offered.",
      "Pound-force and kilogram-force are forces; find them under Force.",
    ],
    groups: [
      {
        group: "Metric",
        source: "si",
        units: [
          { id: "t", name: "tonne", symbol: "t", factor: ex("1000"), aliases: ["metric ton", "metric tonne", "ton", "tons"] },
          { id: "kg", name: "kilogram", symbol: "kg", aliases: ["kilo", "kilos", "kgs"] },
          { id: "g", name: "gram", symbol: "g", factor: ex("0.001"), aliases: ["gm", "grams"] },
          { id: "mg", name: "milligram", symbol: "mg", factor: ex("1e-6") },
          { id: "ug", name: "microgram", symbol: "µg", factor: ex("1e-9"), aliases: ["mcg"] },
          { id: "ng", name: "nanogram", symbol: "ng", factor: ex("1e-12") },
          { id: "ct", name: "metric carat", symbol: "ct", factor: ex("0.0002"), aliases: ["carat", "carats"], source: "nist811" },
        ],
      },
      {
        group: "Avoirdupois (US & imperial)",
        source: "hb44",
        units: [
          { id: "lb", name: "pound", symbol: "lb", factor: POUND, aliases: ["lbs", "pounds", "#"] },
          { id: "oz", name: "ounce", symbol: "oz", factor: per(POUND, ex("16")), aliases: ["ounces", "ozs"] },
          { id: "dr", name: "dram (avoirdupois)", symbol: "dr", factor: per(POUND, ex("256")), aliases: ["dram"] },
          { id: "gr", name: "grain", symbol: "gr", factor: GRAIN, aliases: ["grains"] },
          { id: "st", name: "stone", symbol: "st", factor: times(POUND, ex("14")), aliases: ["stones"], source: "ukWma" },
          { id: "cwt_us", name: "short hundredweight", symbol: "cwt (US)", factor: times(POUND, ex("100")), aliases: ["US hundredweight", "short cwt"] },
          { id: "cwt_uk", name: "long hundredweight", symbol: "cwt (UK)", factor: times(POUND, ex("112")), aliases: ["UK hundredweight", "long cwt"] },
          { id: "ton_us", name: "short ton", symbol: "ton (US)", factor: times(POUND, ex("2000")), aliases: ["US ton", "ton", "tons", "short tons"] },
          { id: "ton_uk", name: "long ton", symbol: "ton (UK)", factor: times(POUND, ex("2240")), aliases: ["UK ton", "imperial ton", "ton", "tons", "long tons"] },
        ],
      },
      {
        group: "Troy",
        source: "hb44",
        units: [
          { id: "ozt", name: "troy ounce", symbol: "oz t", factor: times(GRAIN, ex("480")), aliases: ["ozt", "troy oz", "troy ounces"] },
          { id: "lbt", name: "troy pound", symbol: "lb t", factor: times(GRAIN, ex("5760")), aliases: ["troy pound", "lbt"] },
          { id: "dwt", name: "pennyweight", symbol: "dwt", factor: times(GRAIN, ex("24")) },
        ],
      },
      {
        group: "Engineering",
        source: "nist811",
        units: [
          {
            id: "slug",
            name: "slug",
            symbol: "slug",
            factor: per(POUND_FORCE, FOOT),
            note: "1 lbf·s²/ft.",
          },
        ],
      },
    ],
  }),
  category({
    id: "area",
    name: "Area",
    group: "Everyday",
    description: "Floor plans, land, and surfaces.",
    keywords: "square land floor surface acreage",
    baseUnit: "m2",
    defaultFrom: "ft2",
    defaultTo: "m2",
    presets: [
      ["ft2", "m2"],
      ["acre", "ha"],
      ["mi2", "km2"],
      ["in2", "cm2"],
    ],
    notes: [
      "The acre is 43 560 international square feet. Legacy U.S. survey acres differ by about 4 parts per million.",
    ],
    groups: [
      {
        group: "Metric",
        source: "si",
        units: [
          ...prefixed({ id: "{}m2", name: "square {}meter", symbol: "{}m²" }, ["k"], { power: 2, aliases: (p) => [`sq ${p}m`] }),
          { id: "ha", name: "hectare", symbol: "ha", factor: ex("10000"), aliases: ["hectares"] },
          { id: "a", name: "are", symbol: "a", factor: ex("100"), source: "nist811" },
          { id: "m2", name: "square meter", symbol: "m²", factor: m2, aliases: ["sq m", "sqm"] },
          ...prefixed({ id: "{}m2", name: "square {}meter", symbol: "{}m²" }, ["c", "m"], { power: 2, aliases: (p) => [`sq ${p}m`] }),
        ],
      },
      {
        group: "US customary & imperial",
        source: "hb44",
        units: [
          { id: "in2", name: "square inch", symbol: "in²", factor: SQ_INCH, aliases: ["sq in", "square inches"] },
          { id: "ft2", name: "square foot", symbol: "ft²", factor: SQ_FOOT, aliases: ["sq ft", "sqft", "square feet"] },
          { id: "yd2", name: "square yard", symbol: "yd²", factor: power(YARD, 2), aliases: ["sq yd"] },
          { id: "acre", name: "acre", symbol: "ac", factor: times(SQ_FOOT, ex("43560")), aliases: ["acres"] },
          { id: "mi2", name: "square mile", symbol: "mi²", factor: power(MILE, 2), aliases: ["sq mi", "section"] },
          {
            id: "acre_us",
            name: "U.S. survey acre",
            symbol: "ac (US survey)",
            factor: times(power(SURVEY_FOOT, 2), ex("43560")),
            aliases: ["survey acre"],
            source: "surveyFoot",
            note: "Legacy unit based on the deprecated U.S. survey foot.",
          },
        ],
      },
      {
        group: "Science",
        source: "nist811",
        units: [
          { id: "barn", name: "barn", symbol: "b", factor: ex("1e-28"), aliases: ["barns"] },
          {
            id: "cmil",
            name: "circular mil",
            symbol: "cmil",
            factor: per(times(PI, power(times(INCH, ex("0.001")), 2)), ex("4")),
            note: "Area of a circle one mil in diameter (π/4 mil²).",
          },
        ],
      },
    ],
  }),
  category({
    id: "volume",
    name: "Volume",
    group: "Everyday",
    description: "Liquids, cooking measures, containers, and cubic space.",
    keywords:
      "capacity liquid cooking recipe kitchen cup tablespoon teaspoon gallon",
    baseUnit: "m3",
    defaultFrom: "cup_us",
    defaultTo: "mL",
    presets: [
      ["cup_us", "mL"],
      ["gal_us", "L"],
      ["floz_us", "mL"],
      ["gal_imp", "L"],
      ["tbsp_us", "tsp_us"],
    ],
    notes: [
      "US customary and imperial measures share names but not sizes: a US fluid ounce is 29.57 mL and an imperial fluid ounce is 28.41 mL.",
      "A US customary cup is 8 US fl oz (236.6 mL). US nutrition labels use a 240 mL cup; many recipes outside the US use a 250 mL metric cup.",
      "Volume cannot be converted to weight without the ingredient's density, so cups to grams is intentionally not offered.",
      "The U.S. dry pint, quart, and bushel are different (larger) units from their liquid namesakes.",
    ],
    groups: [
      {
        group: "Metric",
        source: "si",
        units: [
          { id: "m3", name: "cubic meter", symbol: "m³", aliases: ["cu m"] },
          { id: "hL", name: "hectoliter", symbol: "hL", factor: times(LITER, ex("100")) },
          { id: "L", name: "liter", symbol: "L", factor: LITER, aliases: ["l", "liters", "litres", "dm³"] },
          { id: "dL", name: "deciliter", symbol: "dL", factor: times(LITER, ex("0.1")), aliases: ["dl"] },
          { id: "cL", name: "centiliter", symbol: "cL", factor: times(LITER, ex("0.01")), aliases: ["cl"] },
          { id: "mL", name: "milliliter", symbol: "mL", factor: times(LITER, ex("0.001")), aliases: ["ml", "milliliters"] },
          { id: "cm3", name: "cubic centimeter", symbol: "cm³", factor: ex("1e-6"), aliases: ["cc", "ccm"] },
          { id: "uL", name: "microliter", symbol: "µL", factor: times(LITER, ex("1e-6")), aliases: ["µl", "ul"] },
          { id: "mm3", name: "cubic millimeter", symbol: "mm³", factor: ex("1e-9") },
          { id: "km3", name: "cubic kilometer", symbol: "km³", factor: ex("1e9") },
        ],
      },
      {
        group: "Metric cooking",
        source: "convention",
        units: [
          { id: "cup_metric", name: "metric cup", symbol: "cup (metric)", factor: times(LITER, ex("0.25")), aliases: ["metric cup", "cup", "cups"] },
          {
            id: "tbsp_metric",
            name: "metric tablespoon",
            symbol: "tbsp (metric)",
            factor: times(LITER, ex("0.015")),
            aliases: ["metric tablespoon", "tbsp", "tablespoon", "tablespoons", "Tbsp", "T"],
            source: "fda",
            note: "15 mL — also the tablespoon used on US nutrition labels.",
          },
          {
            id: "tsp_metric",
            name: "metric teaspoon",
            symbol: "tsp (metric)",
            factor: times(LITER, ex("0.005")),
            aliases: ["metric teaspoon", "tsp", "teaspoon", "teaspoons", "t"],
            source: "fda",
            note: "5 mL — also the teaspoon used on US nutrition labels.",
          },
        ],
      },
      {
        group: "US liquid (customary)",
        source: "hb44",
        units: [
          { id: "gal_us", name: "US gallon", symbol: "gal (US)", factor: US_GALLON, aliases: ["US gal", "gallon", "gallons", "gal"] },
          { id: "qt_us", name: "US quart", symbol: "qt (US)", factor: per(US_GALLON, ex("4")), aliases: ["US qt", "quart", "quarts", "qt"] },
          { id: "pt_us", name: "US pint", symbol: "pt (US)", factor: per(US_GALLON, ex("8")), aliases: ["US pt", "pint", "pints", "pt"] },
          { id: "cup_us", name: "US cup", symbol: "cup (US)", factor: per(US_GALLON, ex("16")), aliases: ["US cup", "US cups", "cup", "cups", "c"] },
          { id: "gill_us", name: "US gill", symbol: "gi (US)", factor: per(US_GALLON, ex("32")), aliases: ["US gill", "gill"] },
          { id: "floz_us", name: "US fluid ounce", symbol: "fl oz (US)", factor: per(US_GALLON, ex("128")), aliases: ["US fl oz", "fl oz", "floz", "fluid ounce", "fluid ounces"] },
          { id: "tbsp_us", name: "US tablespoon", symbol: "tbsp (US)", factor: per(US_GALLON, ex("256")), aliases: ["US tbsp", "US tablespoon", "tbsp", "tablespoon", "tablespoons", "Tbsp", "T"] },
          { id: "tsp_us", name: "US teaspoon", symbol: "tsp (US)", factor: per(US_GALLON, ex("768")), aliases: ["US tsp", "US teaspoon", "tsp", "teaspoon", "teaspoons", "t"] },
          { id: "fldr_us", name: "US fluid dram", symbol: "fl dr (US)", factor: per(US_GALLON, ex("1024")), aliases: ["US fl dr", "fluid dram"] },
          { id: "bbl_oil", name: "oil barrel", symbol: "bbl", factor: times(US_GALLON, ex("42")), aliases: ["barrel", "barrels", "petroleum barrel"], source: "nist811" },
        ],
      },
      {
        group: "US nutrition labeling",
        source: "fda",
        units: [
          {
            id: "cup_legal",
            name: "US legal cup",
            symbol: "cup (US label)",
            factor: times(LITER, ex("0.24")),
            aliases: ["legal cup", "US legal cup", "cup", "cups"],
            note: "240 mL, used on US Nutrition Facts labels.",
          },
          {
            id: "floz_legal",
            name: "US label fluid ounce",
            symbol: "fl oz (US label)",
            factor: times(LITER, ex("0.03")),
            aliases: ["label fl oz", "fl oz", "fluid ounce", "fluid ounces"],
            note: "30 mL, used on US Nutrition Facts labels.",
          },
        ],
      },
      {
        group: "US dry",
        source: "hb44",
        units: [
          { id: "bu_us", name: "US bushel", symbol: "bu (US)", factor: times(ex("2150.42"), CU_INCH), aliases: ["US bushel", "bushel", "bushels", "bu"] },
          { id: "pk_us", name: "US peck", symbol: "pk (US)", factor: times(ex("537.605"), CU_INCH), aliases: ["US peck", "peck", "pecks"] },
          { id: "drygal_us", name: "US dry gallon", symbol: "dry gal (US)", factor: times(ex("268.8025"), CU_INCH), aliases: ["dry gallon"] },
          { id: "dryqt_us", name: "US dry quart", symbol: "dry qt (US)", factor: times(ex("67.200625"), CU_INCH), aliases: ["dry quart", "dry qt"] },
          { id: "drypt_us", name: "US dry pint", symbol: "dry pt (US)", factor: times(ex("33.6003125"), CU_INCH), aliases: ["dry pint", "dry pt"] },
        ],
      },
      {
        group: "Imperial (UK)",
        source: "ukWma",
        units: [
          { id: "gal_imp", name: "imperial gallon", symbol: "gal (imp)", factor: IMPERIAL_GALLON, aliases: ["imp gal", "UK gal", "UK gallon", "gallon", "gallons", "gal"] },
          { id: "qt_imp", name: "imperial quart", symbol: "qt (imp)", factor: per(IMPERIAL_GALLON, ex("4")), aliases: ["imp qt", "UK quart", "quart", "quarts", "qt"] },
          { id: "pt_imp", name: "imperial pint", symbol: "pt (imp)", factor: per(IMPERIAL_GALLON, ex("8")), aliases: ["imp pt", "UK pint", "pint", "pints", "pt"] },
          { id: "gill_imp", name: "imperial gill", symbol: "gi (imp)", factor: per(IMPERIAL_GALLON, ex("32")), aliases: ["imp gill", "UK gill", "gill"] },
          { id: "floz_imp", name: "imperial fluid ounce", symbol: "fl oz (imp)", factor: per(IMPERIAL_GALLON, ex("160")), aliases: ["imp fl oz", "UK fl oz", "fl oz", "floz", "fluid ounce", "fluid ounces"] },
          { id: "pk_imp", name: "imperial peck", symbol: "pk (imp)", factor: times(IMPERIAL_GALLON, ex("2")), aliases: ["imp peck", "UK peck", "peck", "pecks"] },
          { id: "bu_imp", name: "imperial bushel", symbol: "bu (imp)", factor: times(IMPERIAL_GALLON, ex("8")), aliases: ["imp bushel", "UK bushel", "bushel", "bushels", "bu"] },
        ],
      },
      {
        group: "Cubic & construction",
        source: "hb44",
        units: [
          { id: "in3", name: "cubic inch", symbol: "in³", factor: CU_INCH, aliases: ["cu in", "cubic inches", "ci"] },
          { id: "ft3", name: "cubic foot", symbol: "ft³", factor: CU_FOOT, aliases: ["cu ft", "cubic feet", "cf"] },
          { id: "yd3", name: "cubic yard", symbol: "yd³", factor: power(YARD, 3), aliases: ["cu yd", "cubic yards", "yards of concrete"] },
          { id: "acft", name: "acre-foot", symbol: "ac·ft", factor: times(CU_FOOT, ex("43560")), aliases: ["acre foot", "acre feet", "acre-feet", "af"], note: "Uses the international foot; legacy survey-foot values differ by about 6 ppm." },
          { id: "fbm", name: "board foot", symbol: "FBM", factor: times(CU_INCH, ex("144")), aliases: ["board foot", "board feet", "bd ft"], source: "nist811" },
          { id: "cord", name: "cord (firewood)", symbol: "cord", factor: times(CU_FOOT, ex("128")), aliases: ["cords"], source: "nist811" },
        ],
      },
    ],
  }),
  category({
    id: "time",
    name: "Time",
    group: "Everyday",
    description: "Durations from attoseconds to centuries.",
    keywords: "duration seconds minutes hours days weeks years age elapsed",
    baseUnit: "s",
    defaultFrom: "h",
    defaultTo: "min",
    presets: [
      ["h", "min"],
      ["d", "h"],
      ["wk", "d"],
      ["a_greg", "d"],
    ],
    composites: [
      ["d", "h", "min", "s"],
      ["h", "min", "s"],
    ],
    notes: [
      "A day is 86 400 s. Calendar months and years vary in length, so month and year units are fixed averages (Gregorian: 365.2425 days; Julian: 365.25 days).",
      "Leap seconds and time zones are not considered.",
    ],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          ...prefixed({ id: "s", name: "second", symbol: "s" }, ["a", "f", "p", "n", "µ", "m"]).map((unit) =>
            unit.id === "ms" ? { ...unit, aliases: ["msec"] } : unit,
          ),
          { id: "s", name: "second", symbol: "s", aliases: ["sec", "secs", "seconds"] },
        ],
      },
      {
        group: "Clock & calendar",
        source: "si",
        units: [
          { id: "min", name: "minute", symbol: "min", factor: ex("60"), aliases: ["mins", "minutes"] },
          { id: "h", name: "hour", symbol: "h", factor: HOUR, aliases: ["hr", "hrs", "hours"] },
          { id: "d", name: "day", symbol: "d", factor: DAY, aliases: ["days"] },
          { id: "wk", name: "week", symbol: "wk", factor: times(DAY, ex("7")), aliases: ["week", "weeks"], source: "derived" },
          { id: "fortnight", name: "fortnight", symbol: "fortnight", factor: times(DAY, ex("14")), source: "derived" },
          {
            id: "mo_greg",
            name: "month (average Gregorian)",
            symbol: "mo",
            factor: per(times(DAY, ex("365.2425")), ex("12")),
            aliases: ["month", "months"],
            source: "derived",
            note: "1/12 of an average Gregorian year (30.436875 days).",
          },
          { id: "a_common", name: "common year", symbol: "yr (365 d)", factor: times(DAY, ex("365")), aliases: ["common year"], source: "nist811" },
          {
            id: "a_greg",
            name: "year (average Gregorian)",
            symbol: "yr",
            factor: times(DAY, ex("365.2425")),
            aliases: ["year", "years", "y", "yrs"],
            source: "derived",
            note: "Average over the 400-year Gregorian cycle (97 leap years).",
          },
          { id: "a_jul", name: "Julian year", symbol: "a (Julian)", factor: JULIAN_YEAR, aliases: ["julian year"], source: "iau", note: "365.25 days, used in astronomy." },
          {
            id: "century",
            name: "century (Gregorian average)",
            symbol: "century",
            factor: times(DAY, ex("36524.25")),
            aliases: ["centuries"],
            source: "derived",
          },
        ],
      },
    ],
  }),
  category({
    id: "temperature",
    name: "Temperature",
    group: "Everyday",
    description: "Absolute temperatures — weather, ovens, and science.",
    keywords: "celsius fahrenheit kelvin rankine weather oven thermometer",
    baseUnit: "K",
    defaultFrom: "degF",
    defaultTo: "degC",
    presets: [
      ["degF", "degC"],
      ["degC", "degF"],
      ["degC", "K"],
    ],
    domain: {
      min: rational(0n),
      inclusive: true,
      message:
        "That's below absolute zero (0 K = −273.15 °C = −459.67 °F). To convert a change in temperature, use Temperature difference.",
    },
    notes: [
      "These are temperature readings, which have offsets: 0 °C = 32 °F. To convert a change (such as “10 °C warmer”), use Temperature difference.",
      "Values below absolute zero are rejected.",
    ],
    groups: [
      {
        group: "Scales",
        source: "si",
        units: [
          {
            id: "degC",
            name: "degree Celsius",
            symbol: "°C",
            kind: "affine",
            offset: ex("273.15"),
            aliases: ["celsius", "centigrade", "degC", "deg C", "degrees C"],
            loose: ["C"],
            definition: "T(K) = t(°C) + 273.15",
          },
          {
            id: "degF",
            name: "degree Fahrenheit",
            symbol: "°F",
            kind: "affine",
            factor: frac(5n, 9n),
            offset: ex("459.67"),
            aliases: ["fahrenheit", "degF", "deg F", "degrees F"],
            loose: ["F"],
            source: "nist811",
            definition: "T(K) = (t(°F) + 459.67) × 5/9",
          },
          { id: "K", name: "kelvin", symbol: "K", aliases: ["kelvins", "degrees kelvin"] },
          {
            id: "degR",
            name: "degree Rankine",
            symbol: "°R",
            factor: frac(5n, 9n),
            aliases: ["rankine", "degR", "deg R"],
            loose: ["R"],
            source: "nist811",
          },
        ],
      },
    ],
  }),
  category({
    id: "temperature-difference",
    name: "Temperature difference",
    group: "Everyday",
    description:
      "Temperature changes and intervals, without the scale offsets.",
    keywords: "delta change interval rise increase warmer cooler",
    baseUnit: "dK",
    defaultFrom: "ddegC",
    defaultTo: "ddegF",
    presets: [
      ["ddegC", "ddegF"],
      ["ddegF", "ddegC"],
    ],
    notes: [
      "A change of 1 °C equals a change of 1 K, and a change of 1 °F equals 5/9 K. Negative values (cooling) are allowed.",
    ],
    groups: [
      {
        group: "Intervals",
        source: "nist811",
        units: [
          { id: "dK", name: "kelvin (difference)", symbol: "ΔK", aliases: ["delta K"] },
          { id: "mK", name: "millikelvin (difference)", symbol: "ΔmK", factor: ex("0.001"), aliases: ["mK", "delta mK"] },
          { id: "ddegC", name: "degree Celsius (difference)", symbol: "Δ°C", aliases: ["delta C", "delta °C", "C°"] },
          { id: "ddegF", name: "degree Fahrenheit (difference)", symbol: "Δ°F", factor: frac(5n, 9n), aliases: ["delta F", "delta °F", "F°"] },
          { id: "ddegR", name: "degree Rankine (difference)", symbol: "Δ°R", factor: frac(5n, 9n), aliases: ["delta R", "delta °R"] },
        ],
      },
    ],
  }),
  category({
    id: "speed",
    name: "Speed",
    group: "Everyday",
    description: "Driving, running, wind, and flight speeds.",
    keywords: "velocity pace mph kph knots wind",
    baseUnit: "m/s",
    defaultFrom: "mph",
    defaultTo: "km/h",
    presets: [
      ["mph", "km/h"],
      ["km/h", "m/s"],
      ["kn", "km/h"],
    ],
    notes: [
      "Mach number is not offered: the speed of sound depends on air temperature and composition.",
    ],
    groups: [
      {
        group: "Metric",
        source: "si",
        units: [
          { id: "m/s", name: "meter per second", symbol: "m/s", aliases: ["mps"] },
          { id: "km/h", name: "kilometer per hour", symbol: "km/h", factor: frac(5n, 18n), aliases: ["kph", "kmh", "kmph", "kilometers per hour"] },
          { id: "km/s", name: "kilometer per second", symbol: "km/s", factor: ex("1000") },
          { id: "cm/s", name: "centimeter per second", symbol: "cm/s", factor: ex("0.01") },
        ],
      },
      {
        group: "US customary & imperial",
        source: "derived",
        units: [
          { id: "mph", name: "mile per hour", symbol: "mph", factor: per(MILE, HOUR), aliases: ["mi/h", "miles per hour"] },
          { id: "ft/s", name: "foot per second", symbol: "ft/s", factor: FOOT, aliases: ["fps"] },
          { id: "ft/min", name: "foot per minute", symbol: "ft/min", factor: per(FOOT, ex("60")), aliases: ["fpm"] },
          { id: "in/s", name: "inch per second", symbol: "in/s", factor: INCH, aliases: ["ips"] },
        ],
      },
      {
        group: "Nautical & physics",
        source: "nist811",
        units: [
          { id: "kn", name: "knot", symbol: "kn", factor: per(NAUTICAL_MILE, HOUR), aliases: ["kt", "knots", "kts"] },
          { id: "c", name: "speed of light in vacuum", symbol: "c", factor: SPEED_OF_LIGHT, aliases: ["speed of light"], source: "si" },
        ],
      },
    ],
  }),
  category({
    id: "fuel-economy",
    name: "Fuel economy",
    group: "Everyday",
    description:
      "Miles per gallon and liters per 100 km — including their reciprocal relationship.",
    keywords: "mpg mileage consumption l/100km fuel gas petrol efficiency",
    baseUnit: "km/L",
    defaultFrom: "mpg_us",
    defaultTo: "L/100km",
    presets: [
      ["mpg_us", "L/100km"],
      ["mpg_imp", "L/100km"],
      ["mpg_us", "mpg_imp"],
    ],
    domain: {
      min: rational(0n),
      inclusive: false,
      message: "Fuel economy must be greater than zero.",
    },
    notes: [
      "Distance-per-fuel units (mpg, km/L) and fuel-per-distance units (L/100 km) are reciprocals, so doubling one halves the other.",
      "Zero and negative values are rejected because they have no finite reciprocal.",
      "US and imperial gallons differ, so US mpg and UK mpg are different units.",
    ],
    groups: [
      {
        group: "Distance per volume",
        source: "derived",
        units: [
          { id: "km/L", name: "kilometer per liter", symbol: "km/L", aliases: ["kmpl", "km/l"] },
          { id: "mpg_us", name: "mile per US gallon", symbol: "mpg (US)", factor: per(times(MILE, ex("0.001")), per(US_GALLON, LITER)), aliases: ["US mpg", "mpg", "mi/gal", "miles per gallon"] },
          { id: "mpg_imp", name: "mile per imperial gallon", symbol: "mpg (imp)", factor: per(times(MILE, ex("0.001")), per(IMPERIAL_GALLON, LITER)), aliases: ["UK mpg", "imp mpg", "mpg", "mi/gal", "miles per gallon"] },
          { id: "mi/L", name: "mile per liter", symbol: "mi/L", factor: times(MILE, ex("0.001")) },
        ],
      },
      {
        group: "Volume per distance",
        source: "derived",
        units: [
          {
            id: "L/100km",
            name: "liter per 100 kilometers",
            symbol: "L/100 km",
            kind: "reciprocal",
            factor: ex("100"),
            aliases: ["L/100km", "l/100km", "liters per 100 km", "lp100k"],
            definition: "km/L = 100 ÷ (L/100 km)",
          },
          {
            id: "gal_us/100mi",
            name: "US gallon per 100 miles",
            symbol: "gal (US)/100 mi",
            kind: "reciprocal",
            factor: per(times(MILE, ex("0.1")), per(US_GALLON, LITER)),
            aliases: ["gal/100mi", "US gal/100 mi"],
            definition: "km/L = 160.9344 ÷ (3.785411784 × gal/100 mi)",
          },
          {
            id: "gal_imp/100mi",
            name: "imperial gallon per 100 miles",
            symbol: "gal (imp)/100 mi",
            kind: "reciprocal",
            factor: per(times(MILE, ex("0.1")), per(IMPERIAL_GALLON, LITER)),
            aliases: ["gal/100mi", "imp gal/100 mi"],
            definition: "km/L = 160.9344 ÷ (4.54609 × gal/100 mi)",
          },
        ],
      },
    ],
  }),
  category({
    id: "acceleration",
    name: "Acceleration",
    group: "Science & engineering",
    description: "Rates of change of speed, including g-force.",
    keywords: "g force gravity gee",
    baseUnit: "m/s2",
    defaultFrom: "g0",
    defaultTo: "m/s2",
    presets: [
      ["g0", "m/s2"],
      ["ft/s2", "m/s2"],
    ],
    notes: [
      "Standard gravity g₀ = 9.806 65 m/s² is a conventional value; local gravity varies by location.",
    ],
    groups: [
      {
        group: "Units",
        source: "si",
        units: [
          { id: "m/s2", name: "meter per second squared", symbol: "m/s²", aliases: ["m/s^2", "mps2"] },
          { id: "g0", name: "standard gravity", symbol: "g₀", factor: STANDARD_GRAVITY, aliases: ["gn", "gee", "g-force", "G's"], loose: ["g", "G"] },
          { id: "ft/s2", name: "foot per second squared", symbol: "ft/s²", factor: FOOT, source: "derived" },
          { id: "in/s2", name: "inch per second squared", symbol: "in/s²", factor: INCH, source: "derived" },
          { id: "Gal", name: "gal (galileo)", symbol: "Gal", factor: ex("0.01"), aliases: ["galileo", "cm/s²"], source: "nist811" },
          { id: "mGal", name: "milligal", symbol: "mGal", factor: ex("0.00001"), source: "nist811" },
          { id: "kmh/s", name: "kilometer per hour per second", symbol: "km/h/s", factor: frac(5n, 18n), aliases: ["km/(h·s)", "kph/s"], source: "derived" },
          { id: "mph/s", name: "mile per hour per second", symbol: "mph/s", factor: per(MILE, HOUR), source: "derived" },
        ],
      },
    ],
  }),
  category({
    id: "force",
    name: "Force",
    group: "Science & engineering",
    description: "Pushes, pulls, thrust, and load ratings.",
    keywords: "newton thrust load pound-force kilogram-force",
    baseUnit: "N",
    defaultFrom: "lbf",
    defaultTo: "N",
    presets: [
      ["lbf", "N"],
      ["kgf", "N"],
      ["kN", "kip"],
    ],
    notes: [
      "Kilogram-force and pound-force use standard gravity (9.806 65 m/s²).",
    ],
    groups: [
      {
        group: "SI & metric",
        source: "si",
        units: [
          ...prefixed({ id: "N", name: "newton", symbol: "N" }, ["M", "k"]),
          { id: "N", name: "newton", symbol: "N", aliases: ["newtons"] },
          ...prefixed({ id: "N", name: "newton", symbol: "N" }, ["m"]),
          { id: "dyn", name: "dyne", symbol: "dyn", factor: ex("1e-5"), aliases: ["dynes"], source: "nist811" },
          { id: "kgf", name: "kilogram-force", symbol: "kgf", factor: STANDARD_GRAVITY, aliases: ["kp", "kilopond"], source: "nist811" },
          { id: "gf", name: "gram-force", symbol: "gf", factor: times(STANDARD_GRAVITY, ex("0.001")), source: "derived" },
          { id: "tf", name: "tonne-force", symbol: "tf", factor: times(STANDARD_GRAVITY, ex("1000")), aliases: ["metric ton-force"], source: "derived" },
        ],
      },
      {
        group: "US customary",
        source: "nist811",
        units: [
          { id: "lbf", name: "pound-force", symbol: "lbf", factor: POUND_FORCE, aliases: ["pound force", "pounds force"] },
          { id: "ozf", name: "ounce-force", symbol: "ozf", factor: per(POUND_FORCE, ex("16")) },
          { id: "kip", name: "kip", symbol: "kip", factor: times(POUND_FORCE, ex("1000")), aliases: ["kips", "klbf"] },
          { id: "tonf_us", name: "short ton-force", symbol: "tonf (US)", factor: times(POUND_FORCE, ex("2000")), aliases: ["ton-force"] },
          { id: "pdl", name: "poundal", symbol: "pdl", factor: times(POUND, FOOT), aliases: ["poundals"] },
        ],
      },
    ],
  }),
  category({
    id: "pressure",
    name: "Pressure",
    group: "Science & engineering",
    description: "Tires, weather, blood pressure, and stress.",
    keywords: "psi bar tire tyre barometer atmosphere stress vacuum",
    baseUnit: "Pa",
    defaultFrom: "psi",
    defaultTo: "bar",
    presets: [
      ["psi", "bar"],
      ["psi", "kPa"],
      ["inHg", "hPa"],
      ["mmHg", "kPa"],
    ],
    notes: [
      "Liquid-column units (mmHg, inHg, inH₂O) are conventional values at standard gravity — mercury 13 595.1 kg/m³ and water 1000 kg/m³ — not readings at a particular temperature.",
      "Gauge and absolute pressure are not distinguished. A gauge reading converts to another gauge reading.",
    ],
    groups: [
      {
        group: "SI & metric",
        source: "si",
        units: [
          ...prefixed({ id: "Pa", name: "pascal", symbol: "Pa" }, ["G", "M", "k", "h"]),
          { id: "Pa", name: "pascal", symbol: "Pa", aliases: ["pascals", "N/m²"] },
          { id: "bar", name: "bar", symbol: "bar", factor: ex("100000"), aliases: ["bars"], source: "nist811" },
          { id: "mbar", name: "millibar", symbol: "mbar", factor: ex("100"), aliases: ["mb", "millibars"], source: "nist811" },
          { id: "Ba", name: "barye", symbol: "Ba", factor: ex("0.1"), aliases: ["dyn/cm²"], source: "nist811" },
        ],
      },
      {
        group: "Atmospheres & columns",
        source: "nist811",
        units: [
          { id: "atm", name: "standard atmosphere", symbol: "atm", factor: ex("101325"), aliases: ["atmosphere", "atmospheres"] },
          { id: "at", name: "technical atmosphere", symbol: "at", factor: times(STANDARD_GRAVITY, ex("10000")), aliases: ["kgf/cm²", "kp/cm²"] },
          { id: "Torr", name: "torr", symbol: "Torr", factor: per(ex("101325"), ex("760")), aliases: ["torr"] },
          { id: "mmHg", name: "millimeter of mercury", symbol: "mmHg", factor: times(ex("13595.1"), STANDARD_GRAVITY, ex("0.001")), aliases: ["mm Hg"] },
          { id: "inHg", name: "inch of mercury", symbol: "inHg", factor: times(ex("13595.1"), STANDARD_GRAVITY, INCH), aliases: ["in Hg"] },
          { id: "mmH2O", name: "millimeter of water", symbol: "mmH₂O", factor: times(ex("1000"), STANDARD_GRAVITY, ex("0.001")), aliases: ["mmH2O", "mm wc"] },
          { id: "cmH2O", name: "centimeter of water", symbol: "cmH₂O", factor: times(ex("1000"), STANDARD_GRAVITY, ex("0.01")), aliases: ["cmH2O"] },
          { id: "inH2O", name: "inch of water", symbol: "inH₂O", factor: times(ex("1000"), STANDARD_GRAVITY, INCH), aliases: ["inH2O", "in wc", "in. w.c."] },
          { id: "ftH2O", name: "foot of water", symbol: "ftH₂O", factor: times(ex("1000"), STANDARD_GRAVITY, FOOT), aliases: ["ftH2O"] },
        ],
      },
      {
        group: "US customary",
        source: "nist811",
        units: [
          { id: "psi", name: "pound-force per square inch", symbol: "psi", factor: per(POUND_FORCE, SQ_INCH), aliases: ["lbf/in²", "lb/in2", "pound per square inch"] },
          { id: "ksi", name: "kilopound-force per square inch", symbol: "ksi", factor: per(times(POUND_FORCE, ex("1000")), SQ_INCH) },
          { id: "psf", name: "pound-force per square foot", symbol: "psf", factor: per(POUND_FORCE, SQ_FOOT), aliases: ["lbf/ft²"] },
        ],
      },
    ],
  }),
  category({
    id: "energy",
    name: "Energy",
    group: "Science & engineering",
    description: "Electricity bills, food energy, heat, and physics.",
    keywords: "joule calorie kcal kwh btu electricity heat work food",
    baseUnit: "J",
    defaultFrom: "kWh",
    defaultTo: "MJ",
    presets: [
      ["kWh", "MJ"],
      ["kcal_th", "kJ"],
      ["Btu", "kJ"],
      ["eV", "J"],
    ],
    notes: [
      "Food Calories (kcal) use the thermochemical calorie (4.184 J). The International Table calorie (4.1868 J) is listed separately.",
      "Btu is the International Table Btu (1055.055 852 62 J). U.S. and EC therms follow NIST SP 811.",
      "Ton of TNT is a conventional 4.184 GJ.",
    ],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          ...prefixed({ id: "J", name: "joule", symbol: "J" }, ["G", "M", "k"]),
          { id: "J", name: "joule", symbol: "J", aliases: ["joules"] },
          ...prefixed({ id: "J", name: "joule", symbol: "J" }, ["m"]),
        ],
      },
      {
        group: "Electricity",
        source: "derived",
        units: [
          ...prefixed({ id: "Wh", name: "watt-hour", symbol: "Wh", factor: HOUR }, ["G", "M", "k"]),
          { id: "Wh", name: "watt-hour", symbol: "Wh", factor: HOUR, aliases: ["watt hour"] },
        ],
      },
      {
        group: "Heat & food",
        source: "nist811",
        units: [
          { id: "cal_th", name: "calorie (thermochemical)", symbol: "cal", factor: CALORIE_TH, aliases: ["calorie", "calories", "cal_th"] },
          { id: "kcal_th", name: "kilocalorie (food Calorie)", symbol: "kcal", factor: times(CALORIE_TH, ex("1000")), aliases: ["Cal", "kcal", "food calorie", "Calories", "kilocalorie", "kilocalories"] },
          { id: "cal_IT", name: "calorie (International Table)", symbol: "cal_IT", factor: CALORIE_IT, aliases: ["IT calorie", "calorie", "calories"] },
          { id: "kcal_IT", name: "kilocalorie (International Table)", symbol: "kcal_IT", factor: times(CALORIE_IT, ex("1000")), aliases: ["IT kilocalorie", "kilocalorie", "kilocalories"] },
          { id: "Btu", name: "British thermal unit (IT)", symbol: "Btu", factor: BTU_IT, aliases: ["BTU", "btu", "Btu_IT", "british thermal unit"] },
          { id: "MMBtu", name: "million Btu", symbol: "MMBtu", factor: times(BTU_IT, ex("1e6")), aliases: ["mmbtu", "MBtu"], source: "derived" },
          { id: "thm_us", name: "therm (U.S.)", symbol: "thm (US)", factor: ex("105480400"), aliases: ["therm", "therms", "US therm"] },
          { id: "thm_ec", name: "therm (EC)", symbol: "thm (EC)", factor: ex("105506000"), aliases: ["therm", "therms", "EC therm"] },
          { id: "quad", name: "quad", symbol: "quad", factor: times(BTU_IT, ex("1e15")), aliases: ["quads"], source: "derived", note: "10¹⁵ Btu (IT)." },
          { id: "tTNT", name: "ton of TNT", symbol: "t TNT", factor: ex("4.184e9"), aliases: ["ton of TNT", "tons of TNT"] },
          { id: "ktTNT", name: "kiloton of TNT", symbol: "kt TNT", factor: ex("4.184e12"), aliases: ["kiloton", "kilotons"], source: "derived" },
          { id: "MtTNT", name: "megaton of TNT", symbol: "Mt TNT", factor: ex("4.184e15"), aliases: ["megaton", "megatons"], source: "derived" },
        ],
      },
      {
        group: "Mechanical & physics",
        source: "nist811",
        units: [
          { id: "ftlbf", name: "foot-pound force", symbol: "ft·lbf", factor: times(FOOT, POUND_FORCE), aliases: ["ft-lbf", "foot-pound", "ft·lb", "ft-lb"] },
          { id: "erg", name: "erg", symbol: "erg", factor: ex("1e-7"), aliases: ["ergs"] },
          ...prefixed({ id: "eV", name: "electronvolt", symbol: "eV", factor: ELEMENTARY_CHARGE }, ["T", "G", "M", "k"]),
          { id: "eV", name: "electronvolt", symbol: "eV", factor: ELEMENTARY_CHARGE, aliases: ["electron volt", "electronvolts"], source: "si" },
        ],
      },
    ],
  }),
  category({
    id: "power",
    name: "Power",
    group: "Science & engineering",
    description: "Engines, appliances, heating, and cooling capacity.",
    keywords: "watt horsepower hp btu/h engine motor ac air conditioner",
    baseUnit: "W",
    defaultFrom: "hp",
    defaultTo: "kW",
    presets: [
      ["hp", "kW"],
      ["PS", "kW"],
      ["Btu/h", "W"],
      ["TR", "kW"],
    ],
    notes: [
      "Horsepower has several definitions: mechanical (550 ft·lbf/s), metric (PS, 75 kgf·m/s), and electrical (746 W).",
      "Apparent power (VA) and reactive power (var) are not interchangeable with watts and are not offered.",
    ],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          ...prefixed({ id: "W", name: "watt", symbol: "W" }, ["T", "G", "M", "k"]),
          { id: "W", name: "watt", symbol: "W", aliases: ["watts", "J/s"] },
          ...prefixed({ id: "W", name: "watt", symbol: "W" }, ["m", "µ"]),
        ],
      },
      {
        group: "Horsepower",
        source: "nist811",
        units: [
          { id: "hp", name: "horsepower (mechanical)", symbol: "hp", factor: times(ex("550"), FOOT, POUND_FORCE), aliases: ["horsepower", "bhp", "hp(I)"] },
          { id: "PS", name: "metric horsepower", symbol: "PS", factor: times(ex("75"), STANDARD_GRAVITY), aliases: ["hp(M)", "metric horsepower", "cv", "ch", "horsepower"] },
          { id: "hp_e", name: "electrical horsepower", symbol: "hp(E)", factor: ex("746"), aliases: ["electric horsepower", "horsepower"] },
        ],
      },
      {
        group: "Heating & cooling",
        source: "nist811",
        units: [
          { id: "Btu/h", name: "Btu (IT) per hour", symbol: "Btu/h", factor: per(BTU_IT, HOUR), aliases: ["BTU/h", "Btu/hr", "BTU/hr", "btuh"] },
          { id: "TR", name: "ton of refrigeration", symbol: "TR", factor: per(times(BTU_IT, ex("12000")), HOUR), aliases: ["refrigeration ton", "RT", "tons of cooling"] },
          { id: "kcal/h", name: "kilocalorie (IT) per hour", symbol: "kcal_IT/h", factor: per(times(CALORIE_IT, ex("1000")), HOUR), aliases: ["kcal/h", "kcal/hr"] },
        ],
      },
      {
        group: "Mechanical",
        source: "nist811",
        units: [
          { id: "ftlbf/s", name: "foot-pound force per second", symbol: "ft·lbf/s", factor: times(FOOT, POUND_FORCE) },
          { id: "erg/s", name: "erg per second", symbol: "erg/s", factor: ex("1e-7") },
        ],
      },
    ],
  }),
  category({
    id: "torque",
    name: "Torque",
    group: "Science & engineering",
    description: "Bolt tightening, engine output, and moments.",
    keywords: "moment wrench bolt tightening engine",
    baseUnit: "N·m",
    defaultFrom: "lbf·ft",
    defaultTo: "N·m",
    presets: [
      ["lbf·ft", "N·m"],
      ["lbf·in", "N·m"],
      ["kgf·m", "N·m"],
    ],
    notes: [
      "Torque shares dimensions with energy but is a different quantity, so it is kept separate.",
    ],
    groups: [
      {
        group: "SI & metric",
        source: "si",
        units: [
          { id: "kN·m", name: "kilonewton meter", symbol: "kN·m", factor: ex("1000"), aliases: ["kNm"] },
          { id: "N·m", name: "newton meter", symbol: "N·m", aliases: ["Nm", "newton-meter", "newton meters"] },
          { id: "N·cm", name: "newton centimeter", symbol: "N·cm", factor: ex("0.01"), aliases: ["Ncm"] },
          { id: "N·mm", name: "newton millimeter", symbol: "N·mm", factor: ex("0.001"), aliases: ["Nmm"] },
          { id: "kgf·m", name: "kilogram-force meter", symbol: "kgf·m", factor: STANDARD_GRAVITY, aliases: ["kgm", "kg·m", "kpm"], source: "nist811" },
          { id: "kgf·cm", name: "kilogram-force centimeter", symbol: "kgf·cm", factor: times(STANDARD_GRAVITY, ex("0.01")), aliases: ["kg·cm", "kgcm"], source: "nist811" },
          { id: "dyn·cm", name: "dyne centimeter", symbol: "dyn·cm", factor: ex("1e-7"), source: "nist811" },
        ],
      },
      {
        group: "US customary",
        source: "nist811",
        units: [
          { id: "lbf·ft", name: "pound-force foot", symbol: "lbf·ft", factor: times(POUND_FORCE, FOOT), aliases: ["lb·ft", "lb-ft", "ft-lb", "ft·lbf", "ft lbs", "foot-pounds"] },
          { id: "lbf·in", name: "pound-force inch", symbol: "lbf·in", factor: times(POUND_FORCE, INCH), aliases: ["lb·in", "in-lb", "in·lbf", "in lbs", "inch-pounds"] },
          { id: "ozf·in", name: "ounce-force inch", symbol: "ozf·in", factor: times(per(POUND_FORCE, ex("16")), INCH), aliases: ["oz·in", "oz-in", "in-oz"] },
        ],
      },
    ],
  }),
  category({
    id: "density",
    name: "Density",
    group: "Science & engineering",
    description: "Mass per unit volume for materials and liquids.",
    keywords: "specific gravity mass per volume material",
    baseUnit: "kg/m3",
    defaultFrom: "g/cm3",
    defaultTo: "lb/ft3",
    presets: [
      ["g/cm3", "kg/m3"],
      ["lb/ft3", "kg/m3"],
      ["lb/gal_us", "kg/L"],
    ],
    notes: [
      "1 g/cm³ = 1 g/mL = 1 kg/L = 1000 kg/m³.",
    ],
    groups: [
      {
        group: "Metric",
        source: "si",
        units: [
          { id: "kg/m3", name: "kilogram per cubic meter", symbol: "kg/m³", aliases: ["g/L", "g/l", "kg/m3"] },
          { id: "g/cm3", name: "gram per cubic centimeter", symbol: "g/cm³", factor: ex("1000"), aliases: ["g/cc", "g/mL", "g/ml", "t/m³"] },
          { id: "kg/L", name: "kilogram per liter", symbol: "kg/L", factor: ex("1000"), aliases: ["kg/l", "kg/dm³"] },
          { id: "mg/L", name: "milligram per liter", symbol: "mg/L", factor: ex("0.001"), aliases: ["mg/l", "g/m³"] },
        ],
      },
      {
        group: "US customary & imperial",
        source: "nist811",
        units: [
          { id: "lb/ft3", name: "pound per cubic foot", symbol: "lb/ft³", factor: per(POUND, CU_FOOT), aliases: ["pcf", "lb/cu ft"] },
          { id: "lb/in3", name: "pound per cubic inch", symbol: "lb/in³", factor: per(POUND, CU_INCH), aliases: ["lb/cu in"] },
          { id: "oz/in3", name: "ounce per cubic inch", symbol: "oz/in³", factor: per(per(POUND, ex("16")), CU_INCH) },
          { id: "lb/gal_us", name: "pound per US gallon", symbol: "lb/gal (US)", factor: per(POUND, US_GALLON), aliases: ["ppg", "lb/US gal"] },
          { id: "lb/gal_imp", name: "pound per imperial gallon", symbol: "lb/gal (imp)", factor: per(POUND, IMPERIAL_GALLON), aliases: ["lb/imp gal"] },
          { id: "slug/ft3", name: "slug per cubic foot", symbol: "slug/ft³", factor: per(per(POUND_FORCE, FOOT), CU_FOOT) },
        ],
      },
    ],
  }),
  category({
    id: "volume-flow",
    name: "Flow rate",
    group: "Science & engineering",
    description: "Volumetric flow for pumps, pipes, and ventilation.",
    keywords: "volumetric flow gpm cfm pump pipe water air ventilation",
    baseUnit: "m3/s",
    defaultFrom: "gpm_us",
    defaultTo: "L/min",
    presets: [
      ["gpm_us", "L/min"],
      ["cfm", "m3/h"],
      ["L/s", "m3/h"],
    ],
    notes: ["Volumetric flow only; mass flow is a separate category."],
    groups: [
      {
        group: "Metric",
        source: "derived",
        units: [
          { id: "m3/s", name: "cubic meter per second", symbol: "m³/s", aliases: ["cumecs"] },
          { id: "m3/h", name: "cubic meter per hour", symbol: "m³/h", factor: per(ONE, HOUR) },
          { id: "L/s", name: "liter per second", symbol: "L/s", factor: LITER, aliases: ["l/s", "lps"] },
          { id: "L/min", name: "liter per minute", symbol: "L/min", factor: per(LITER, ex("60")), aliases: ["l/min", "lpm"] },
          { id: "L/h", name: "liter per hour", symbol: "L/h", factor: per(LITER, HOUR), aliases: ["l/h", "lph"] },
          { id: "mL/min", name: "milliliter per minute", symbol: "mL/min", factor: per(times(LITER, ex("0.001")), ex("60")), aliases: ["ml/min"] },
        ],
      },
      {
        group: "US customary & imperial",
        source: "derived",
        units: [
          { id: "cfs", name: "cubic foot per second", symbol: "ft³/s", factor: CU_FOOT, aliases: ["cfs", "cusec"] },
          { id: "cfm", name: "cubic foot per minute", symbol: "ft³/min", factor: per(CU_FOOT, ex("60")), aliases: ["cfm"] },
          { id: "gpm_us", name: "US gallon per minute", symbol: "gal (US)/min", factor: per(US_GALLON, ex("60")), aliases: ["gpm", "US gpm"] },
          { id: "gph_us", name: "US gallon per hour", symbol: "gal (US)/h", factor: per(US_GALLON, HOUR), aliases: ["gph"] },
          { id: "mgd_us", name: "million US gallons per day", symbol: "MGD", factor: per(times(US_GALLON, ex("1e6")), DAY), aliases: ["mgd"] },
          { id: "gpm_imp", name: "imperial gallon per minute", symbol: "gal (imp)/min", factor: per(IMPERIAL_GALLON, ex("60")), aliases: ["UK gpm", "imp gpm"] },
          { id: "bbl/d", name: "oil barrel per day", symbol: "bbl/d", factor: per(times(US_GALLON, ex("42")), DAY), aliases: ["bpd", "barrels per day"] },
        ],
      },
    ],
  }),
  category({
    id: "mass-flow",
    name: "Mass flow rate",
    group: "Science & engineering",
    description: "Mass moved per unit time in processes and engines.",
    keywords: "mass flow throughput process",
    baseUnit: "kg/s",
    defaultFrom: "lb/h",
    defaultTo: "kg/h",
    presets: [
      ["lb/h", "kg/h"],
      ["t/h", "kg/s"],
    ],
    notes: [],
    groups: [
      {
        group: "Units",
        source: "derived",
        units: [
          { id: "kg/s", name: "kilogram per second", symbol: "kg/s" },
          { id: "g/s", name: "gram per second", symbol: "g/s", factor: ex("0.001") },
          { id: "kg/h", name: "kilogram per hour", symbol: "kg/h", factor: per(ONE, HOUR) },
          { id: "t/h", name: "tonne per hour", symbol: "t/h", factor: per(ex("1000"), HOUR) },
          { id: "lb/s", name: "pound per second", symbol: "lb/s", factor: POUND },
          { id: "lb/h", name: "pound per hour", symbol: "lb/h", factor: per(POUND, HOUR), aliases: ["pph", "lb/hr"] },
        ],
      },
    ],
  }),
  category({
    id: "angle",
    name: "Angle",
    group: "Science & engineering",
    description: "Rotation, slope direction, navigation, and astronomy.",
    keywords: "degrees radians rotation bearing arc",
    baseUnit: "rad",
    defaultFrom: "deg",
    defaultTo: "rad",
    presets: [
      ["deg", "rad"],
      ["rad", "deg"],
      ["deg", "grad"],
    ],
    composites: [["deg", "arcmin", "arcsec"]],
    notes: [
      "Conversions between radians and degree-based units involve π and are shown as approximations.",
      "Military mils are not offered because NATO (6400/turn), Warsaw Pact (6000/turn), and other definitions differ.",
    ],
    groups: [
      {
        group: "Units",
        source: "si",
        units: [
          { id: "rad", name: "radian", symbol: "rad", aliases: ["radians"] },
          { id: "mrad", name: "milliradian", symbol: "mrad", factor: ex("0.001") },
          { id: "urad", name: "microradian", symbol: "µrad", factor: ex("1e-6") },
          { id: "deg", name: "degree", symbol: "°", factor: per(PI, ex("180")), aliases: ["deg", "degrees", "degree of arc"] },
          { id: "arcmin", name: "arcminute", symbol: "′", factor: per(PI, ex("10800")), aliases: ["arcmin", "arc minute", "MOA"] },
          { id: "arcsec", name: "arcsecond", symbol: "″", factor: per(PI, ex("648000")), aliases: ["arcsec", "arc second"] },
          { id: "mas", name: "milliarcsecond", symbol: "mas", factor: per(PI, ex("648000000")) },
          { id: "grad", name: "gradian", symbol: "gon", factor: per(PI, ex("200")), aliases: ["grad", "grade", "gradians"], source: "nist811" },
          { id: "turn", name: "turn", symbol: "tr", factor: times(PI, ex("2")), aliases: ["turns", "revolution", "rev", "revolutions", "rotations", "cycle"], source: "derived" },
        ],
      },
    ],
  }),
  category({
    id: "angular-velocity",
    name: "Angular velocity",
    group: "Science & engineering",
    description: "Rotational speed of motors, wheels, and drives.",
    keywords: "rpm rotation speed spin rotational",
    baseUnit: "rad/s",
    defaultFrom: "rpm",
    defaultTo: "rad/s",
    presets: [
      ["rpm", "rad/s"],
      ["rpm", "deg/s"],
    ],
    notes: [
      "One revolution is 2π rad, so conversions between rad/s and rpm are approximate.",
    ],
    groups: [
      {
        group: "Units",
        source: "derived",
        units: [
          { id: "rad/s", name: "radian per second", symbol: "rad/s" },
          { id: "deg/s", name: "degree per second", symbol: "°/s", factor: per(PI, ex("180")), aliases: ["deg/s", "dps"] },
          { id: "deg/h", name: "degree per hour", symbol: "°/h", factor: per(PI, ex("648000")), aliases: ["deg/h"] },
          { id: "rpm", name: "revolution per minute", symbol: "rpm", factor: per(times(PI, ex("2")), ex("60")), aliases: ["r/min", "rev/min", "RPM"] },
          { id: "rps", name: "revolution per second", symbol: "rev/s", factor: times(PI, ex("2")), aliases: ["rps", "r/s"] },
        ],
      },
    ],
  }),
  category({
    id: "frequency",
    name: "Frequency",
    group: "Science & engineering",
    description: "Cycles per second for radio, audio, and processors.",
    keywords: "hertz cycles radio audio clock bpm",
    baseUnit: "Hz",
    defaultFrom: "MHz",
    defaultTo: "kHz",
    presets: [
      ["MHz", "kHz"],
      ["GHz", "MHz"],
      ["per_min", "Hz"],
    ],
    notes: [
      "For rotational speed in rpm, use Angular velocity.",
    ],
    groups: [
      {
        group: "Units",
        source: "si",
        units: [
          ...prefixed({ id: "Hz", name: "hertz", symbol: "Hz" }, ["T", "G", "M", "k"]),
          { id: "Hz", name: "hertz", symbol: "Hz", aliases: ["cps", "cycles per second", "1/s"] },
          ...prefixed({ id: "Hz", name: "hertz", symbol: "Hz" }, ["m"]),
          { id: "per_min", name: "cycles per minute", symbol: "/min", factor: frac(1n, 60n), aliases: ["bpm", "per minute", "cpm", "1/min"], source: "derived" },
          { id: "per_h", name: "cycles per hour", symbol: "/h", factor: frac(1n, 3600n), aliases: ["per hour", "1/h"], source: "derived" },
        ],
      },
    ],
  }),
  category({
    id: "dynamic-viscosity",
    name: "Dynamic viscosity",
    group: "Science & engineering",
    description: "Resistance of fluids to shear.",
    keywords: "viscosity poise centipoise oil fluid",
    baseUnit: "Pa·s",
    defaultFrom: "cP",
    defaultTo: "Pa·s",
    presets: [["cP", "mPa·s"]],
    notes: ["1 cP = 1 mPa·s."],
    groups: [
      {
        group: "Units",
        source: "nist811",
        units: [
          { id: "Pa·s", name: "pascal second", symbol: "Pa·s", aliases: ["Pas", "Pa s"], source: "si" },
          { id: "mPa·s", name: "millipascal second", symbol: "mPa·s", factor: ex("0.001"), aliases: ["mPas"], source: "si" },
          { id: "P", name: "poise", symbol: "P", factor: ex("0.1") },
          { id: "cP", name: "centipoise", symbol: "cP", factor: ex("0.001"), aliases: ["cps viscosity"] },
          { id: "lb/(ft·s)", name: "pound per foot second", symbol: "lb/(ft·s)", factor: per(POUND, FOOT) },
          { id: "lbf·s/ft2", name: "pound-force second per square foot", symbol: "lbf·s/ft²", factor: per(POUND_FORCE, SQ_FOOT) },
        ],
      },
    ],
  }),
  category({
    id: "kinematic-viscosity",
    name: "Kinematic viscosity",
    group: "Science & engineering",
    description: "Viscosity relative to density, as on oil data sheets.",
    keywords: "viscosity stokes centistokes oil cst",
    baseUnit: "m2/s",
    defaultFrom: "cSt",
    defaultTo: "mm2/s",
    presets: [["cSt", "mm2/s"]],
    notes: ["1 cSt = 1 mm²/s."],
    groups: [
      {
        group: "Units",
        source: "nist811",
        units: [
          { id: "m2/s", name: "square meter per second", symbol: "m²/s", source: "si" },
          { id: "mm2/s", name: "square millimeter per second", symbol: "mm²/s", factor: ex("1e-6"), source: "si" },
          { id: "St", name: "stokes", symbol: "St", factor: ex("1e-4") },
          { id: "cSt", name: "centistokes", symbol: "cSt", factor: ex("1e-6") },
          { id: "ft2/s", name: "square foot per second", symbol: "ft²/s", factor: SQ_FOOT },
        ],
      },
    ],
  }),
  category({
    id: "amount",
    name: "Amount of substance",
    group: "Science & engineering",
    description: "Moles for chemistry and process engineering.",
    keywords: "mole chemistry stoichiometry",
    baseUnit: "mol",
    defaultFrom: "mmol",
    defaultTo: "mol",
    presets: [["mmol", "umol"]],
    notes: ["The mole contains exactly 6.022 140 76 × 10²³ elementary entities."],
    groups: [
      {
        group: "Units",
        source: "si",
        units: [
          ...prefixed({ id: "mol", name: "mole", symbol: "mol" }, ["k"]),
          { id: "mol", name: "mole", symbol: "mol", aliases: ["moles"] },
          ...prefixed({ id: "mol", name: "mole", symbol: "mol" }, ["m", "µ", "n"]),
          { id: "lbmol", name: "pound-mole", symbol: "lb-mol", factor: ex("453.59237"), aliases: ["lbmol"], source: "derived" },
          { id: "entities", name: "entities (particles)", symbol: "entities", factor: per(ONE, AVOGADRO), aliases: ["particles", "molecules", "atoms"], note: "Counted via the Avogadro constant." },
        ],
      },
    ],
  }),
  category({
    id: "specific-energy",
    name: "Specific energy",
    group: "Science & engineering",
    description: "Energy per unit mass for fuels, batteries, and heat.",
    keywords: "energy density heating value battery fuel enthalpy",
    baseUnit: "J/kg",
    defaultFrom: "Btu/lb",
    defaultTo: "kJ/kg",
    presets: [
      ["Btu/lb", "kJ/kg"],
      ["Wh/kg", "MJ/kg"],
    ],
    notes: ["Btu/lb uses the International Table Btu (exactly 2.326 kJ/kg)."],
    groups: [
      {
        group: "Units",
        source: "derived",
        units: [
          { id: "J/kg", name: "joule per kilogram", symbol: "J/kg" },
          { id: "kJ/kg", name: "kilojoule per kilogram", symbol: "kJ/kg", factor: ex("1000") },
          { id: "MJ/kg", name: "megajoule per kilogram", symbol: "MJ/kg", factor: ex("1e6") },
          { id: "Wh/kg", name: "watt-hour per kilogram", symbol: "Wh/kg", factor: HOUR },
          { id: "kWh/kg", name: "kilowatt-hour per kilogram", symbol: "kWh/kg", factor: times(HOUR, ex("1000")) },
          { id: "Btu/lb", name: "Btu (IT) per pound", symbol: "Btu/lb", factor: per(BTU_IT, POUND), source: "nist811" },
          { id: "cal/g", name: "calorie (thermochemical) per gram", symbol: "cal/g", factor: times(CALORIE_TH, ex("1000")) },
        ],
      },
    ],
  }),
  // ----- Electricity & magnetism ------------------------------------------
  category({
    id: "current",
    name: "Electric current",
    group: "Electricity & magnetism",
    description: "Amperes from microamps to kiloamps.",
    keywords: "amps amperage electric current",
    baseUnit: "A",
    defaultFrom: "mA",
    defaultTo: "A",
    presets: [["mA", "A"]],
    notes: ["CGS electrostatic and electromagnetic units are derived from the exact speed of light."],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          ...prefixed({ id: "A", name: "ampere", symbol: "A" }, ["k"]),
          { id: "A", name: "ampere", symbol: "A", aliases: ["amp", "amps", "amperes"] },
          ...prefixed({ id: "A", name: "ampere", symbol: "A" }, ["m", "µ", "n"]),
        ],
      },
      {
        group: "CGS",
        source: "nist811",
        units: [
          { id: "abA", name: "abampere", symbol: "abA", factor: ex("10"), aliases: ["biot", "Bi"] },
          { id: "statA", name: "statampere", symbol: "statA", factor: per(ex("10"), C_CGS) },
        ],
      },
    ],
  }),
  category({
    id: "voltage",
    name: "Voltage",
    group: "Electricity & magnetism",
    description: "Electric potential difference.",
    keywords: "volts potential electromotive emf",
    baseUnit: "V",
    defaultFrom: "kV",
    defaultTo: "V",
    presets: [["mV", "V"]],
    notes: [],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          ...prefixed({ id: "V", name: "volt", symbol: "V" }, ["M", "k"]),
          { id: "V", name: "volt", symbol: "V", aliases: ["volts"] },
          ...prefixed({ id: "V", name: "volt", symbol: "V" }, ["m", "µ"]),
        ],
      },
      {
        group: "CGS",
        source: "nist811",
        units: [
          { id: "abV", name: "abvolt", symbol: "abV", factor: ex("1e-8") },
          { id: "statV", name: "statvolt", symbol: "statV", factor: times(C_CGS, ex("1e-8")) },
        ],
      },
    ],
  }),
  category({
    id: "resistance",
    name: "Electric resistance",
    group: "Electricity & magnetism",
    description: "Ohms for resistors, wiring, and insulation.",
    keywords: "ohm resistor impedance",
    baseUnit: "ohm",
    defaultFrom: "kohm",
    defaultTo: "ohm",
    presets: [["kohm", "ohm"], ["Mohm", "kohm"]],
    notes: [],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          ...prefixed({ id: "ohm", name: "ohm", symbol: "Ω", factor: ONE }, ["G", "M", "k"], { aliases: (p) => [`${p}ohm`] }),
          { id: "ohm", name: "ohm", symbol: "Ω", aliases: ["ohms"] },
          ...prefixed({ id: "ohm", name: "ohm", symbol: "Ω", factor: ONE }, ["m", "µ"], { aliases: (p) => [`${p}ohm`] }),
        ],
      },
      {
        group: "CGS",
        source: "nist811",
        units: [
          { id: "abohm", name: "abohm", symbol: "abΩ", factor: ex("1e-9"), aliases: ["abohm"] },
          { id: "statohm", name: "statohm", symbol: "statΩ", factor: times(power(C_CGS, 2), ex("1e-9")), aliases: ["statohm"] },
        ],
      },
    ],
  }),
  category({
    id: "conductance",
    name: "Electric conductance",
    group: "Electricity & magnetism",
    description: "Siemens, the reciprocal of ohms.",
    keywords: "siemens mho conductivity",
    baseUnit: "S",
    defaultFrom: "mS",
    defaultTo: "uS",
    presets: [["mS", "uS"]],
    notes: ["The mho is an older name for the siemens."],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          { id: "S", name: "siemens", symbol: "S", aliases: ["mho", "℧"] },
          ...prefixed({ id: "S", name: "siemens", symbol: "S" }, ["m", "µ", "n"]),
        ],
      },
    ],
  }),
  category({
    id: "charge",
    name: "Electric charge",
    group: "Electricity & magnetism",
    description: "Coulombs and battery capacity in amp-hours.",
    keywords: "coulomb battery capacity mah amp hour",
    baseUnit: "C",
    defaultFrom: "mAh",
    defaultTo: "C",
    presets: [
      ["mAh", "C"],
      ["Ah", "mAh"],
    ],
    notes: [
      "Battery capacity in mAh measures charge, not energy. Converting to Wh requires the battery voltage.",
    ],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          { id: "C", name: "coulomb", symbol: "C", aliases: ["coulombs"] },
          ...prefixed({ id: "C", name: "coulomb", symbol: "C" }, ["m", "µ", "n", "p"]),
          { id: "e", name: "elementary charge", symbol: "e", factor: ELEMENTARY_CHARGE },
          { id: "F_charge", name: "faraday", symbol: "F (charge)", factor: times(ELEMENTARY_CHARGE, AVOGADRO), aliases: ["faraday", "faradays"], note: "Charge of one mole of elementary charges (e × Nₐ)." },
        ],
      },
      {
        group: "Battery capacity",
        source: "derived",
        units: [
          { id: "Ah", name: "ampere-hour", symbol: "Ah", factor: HOUR, aliases: ["amp hour", "amp-hours", "A·h"] },
          { id: "mAh", name: "milliampere-hour", symbol: "mAh", factor: ex("3.6"), aliases: ["milliamp hour", "mA·h"] },
        ],
      },
      {
        group: "CGS",
        source: "nist811",
        units: [
          { id: "abC", name: "abcoulomb", symbol: "abC", factor: ex("10") },
          { id: "statC", name: "statcoulomb", symbol: "statC", factor: per(ex("10"), C_CGS), aliases: ["franklin", "Fr", "esu"] },
        ],
      },
    ],
  }),
  category({
    id: "capacitance",
    name: "Capacitance",
    group: "Electricity & magnetism",
    description: "Farads for capacitors.",
    keywords: "farad capacitor microfarad picofarad",
    baseUnit: "F",
    defaultFrom: "uF",
    defaultTo: "nF",
    presets: [
      ["uF", "nF"],
      ["nF", "pF"],
    ],
    notes: [],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          { id: "F", name: "farad", symbol: "F", aliases: ["farads"] },
          ...prefixed({ id: "F", name: "farad", symbol: "F" }, ["m", "µ", "n", "p"]).map((unit) =>
            unit.id === "uF" ? { ...unit, aliases: ["mfd", "MFD"] } : unit,
          ),
        ],
      },
    ],
  }),
  category({
    id: "inductance",
    name: "Inductance",
    group: "Electricity & magnetism",
    description: "Henries for coils and inductors.",
    keywords: "henry inductor coil",
    baseUnit: "H",
    defaultFrom: "mH",
    defaultTo: "uH",
    presets: [["mH", "uH"]],
    notes: [],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          { id: "H", name: "henry", symbol: "H", aliases: ["henries", "henrys"] },
          ...prefixed({ id: "H", name: "henry", symbol: "H" }, ["m", "µ", "n"]),
        ],
      },
    ],
  }),
  category({
    id: "magnetic-flux-density",
    name: "Magnetic flux density",
    group: "Electricity & magnetism",
    description: "Tesla and gauss for magnets and fields.",
    keywords: "magnetic field tesla gauss magnet",
    baseUnit: "T",
    defaultFrom: "G",
    defaultTo: "mT",
    presets: [["G", "mT"], ["T", "G"]],
    notes: [],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          { id: "T", name: "tesla", symbol: "T", aliases: ["teslas"] },
          ...prefixed({ id: "T", name: "tesla", symbol: "T" }, ["m", "µ", "n"]),
        ],
      },
      {
        group: "CGS",
        source: "nist811",
        units: [
          { id: "G", name: "gauss", symbol: "G", factor: ex("1e-4"), aliases: ["Gs"] },
          { id: "mG", name: "milligauss", symbol: "mG", factor: ex("1e-7") },
          { id: "gamma", name: "gamma", symbol: "γ", factor: ex("1e-9"), aliases: ["gamma"] },
        ],
      },
    ],
  }),
  category({
    id: "magnetic-flux",
    name: "Magnetic flux",
    group: "Electricity & magnetism",
    description: "Webers and maxwells.",
    keywords: "weber maxwell flux",
    baseUnit: "Wb",
    defaultFrom: "Mx",
    defaultTo: "uWb",
    presets: [["Mx", "Wb"]],
    notes: [],
    groups: [
      {
        group: "Units",
        source: "si",
        units: [
          { id: "Wb", name: "weber", symbol: "Wb", aliases: ["webers"] },
          ...prefixed({ id: "Wb", name: "weber", symbol: "Wb" }, ["m", "µ"]),
          { id: "Mx", name: "maxwell", symbol: "Mx", factor: ex("1e-8"), aliases: ["maxwells"], source: "nist811" },
        ],
      },
    ],
  }),
  // ----- Digital ----------------------------------------------------------
  category({
    id: "data-storage",
    name: "Data storage",
    group: "Digital",
    description: "Bits and bytes with decimal (SI) and binary (IEC) prefixes.",
    keywords:
      "bytes bits file size disk drive memory megabyte gigabyte terabyte gibibyte",
    baseUnit: "bit",
    defaultFrom: "GB",
    defaultTo: "GiB",
    presets: [
      ["GB", "GiB"],
      ["TB", "TiB"],
      ["MB", "Mbit"],
    ],
    notes: [
      "SI prefixes are decimal: 1 kB = 1000 B. IEC prefixes are binary: 1 KiB = 1024 B (IEC 80000-13).",
      "Some software labels binary sizes as KB/MB/GB. A drive sold as 1 TB holds about 0.909 TiB.",
      "A byte is 8 bits. A lowercase b means bit; an uppercase B means byte.",
    ],
    groups: [
      {
        group: "Bits",
        source: "iec",
        units: [
          { id: "bit", name: "bit", symbol: "bit", aliases: ["bits", "b"] },
          { id: "nibble", name: "nibble", symbol: "nibble", factor: ex("4"), aliases: ["nibbles", "nybble"], source: "convention" },
          ...prefixed({ id: "bit", name: "bit", symbol: "bit" }, ["k", "M", "G", "T", "P"], {
            aliases: (p) => [`${p}b`, `${p.toUpperCase()}bit`],
          }).map((unit) => ({ ...unit, source: "si" as const })),
          ...binary({ id: "bit", name: "bit", symbol: "bit" }, 4, (p) => [`${p}b`]),
        ],
      },
      {
        group: "Bytes (decimal, SI)",
        source: "si",
        units: [
          { id: "B", name: "byte", symbol: "B", factor: ex("8"), aliases: ["bytes", "octet", "octets", "o"], source: "iec" },
          ...prefixed({ id: "B", name: "byte", symbol: "B", factor: ex("8") }, ["k", "M", "G", "T", "P", "E", "Z", "Y", "R", "Q"]),
        ],
      },
      {
        group: "Bytes (binary, IEC)",
        source: "iec",
        units: binary({ id: "B", name: "byte", symbol: "B", factor: ex("8") }, 8),
      },
    ],
  }),
  category({
    id: "data-rate",
    name: "Data rate",
    group: "Digital",
    description: "Network and transfer speeds — megabits vs megabytes.",
    keywords: "bandwidth internet speed mbps download upload throughput",
    baseUnit: "bit/s",
    defaultFrom: "Mbit/s",
    defaultTo: "MB/s",
    presets: [
      ["Mbit/s", "MB/s"],
      ["Gbit/s", "MB/s"],
      ["MiB/s", "Mbit/s"],
    ],
    notes: [
      "Internet plans are usually quoted in megabits per second (Mbps). Download managers often show megabytes per second (MB/s): divide by 8.",
    ],
    groups: [
      {
        group: "Bits per second",
        source: "si",
        units: [
          { id: "bit/s", name: "bit per second", symbol: "bit/s", aliases: ["bps", "b/s"] },
          ...prefixed({ id: "bit/s", name: "bit per second", symbol: "bit/s" }, ["k", "M", "G", "T"], {
            aliases: (p) => [`${p}bps`, `${p}b/s`, `${p.toUpperCase()}bps`],
          }),
          ...binary({ id: "bit/s", name: "bit per second", symbol: "bit/s" }, 3),
        ],
      },
      {
        group: "Bytes per second",
        source: "si",
        units: [
          { id: "B/s", name: "byte per second", symbol: "B/s", factor: ex("8"), aliases: ["Bps"] },
          ...prefixed({ id: "B/s", name: "byte per second", symbol: "B/s", factor: ex("8") }, ["k", "M", "G", "T"], {
            aliases: (p) => [`${p}Bps`],
          }),
          ...binary({ id: "B/s", name: "byte per second", symbol: "B/s", factor: ex("8") }, 3),
        ],
      },
    ],
  }),
  // ----- Light & radiation ------------------------------------------------
  category({
    id: "illuminance",
    name: "Illuminance",
    group: "Light & radiation",
    description: "Light falling on a surface, for lighting design and photography.",
    keywords: "lux foot-candle light level lighting",
    baseUnit: "lx",
    defaultFrom: "fc",
    defaultTo: "lx",
    presets: [["fc", "lx"]],
    notes: [
      "Illuminance (lux) is not convertible to luminous flux (lumens) or luminance (nits) without geometry.",
    ],
    groups: [
      {
        group: "Units",
        source: "nist811",
        units: [
          { id: "lx", name: "lux", symbol: "lx", aliases: ["lumen per square meter", "lm/m²"], source: "si" },
          { id: "klx", name: "kilolux", symbol: "klx", factor: ex("1000"), source: "si" },
          { id: "fc", name: "foot-candle", symbol: "fc", factor: per(ONE, SQ_FOOT), aliases: ["footcandle", "foot candles", "lm/ft²"] },
          { id: "ph", name: "phot", symbol: "ph", factor: ex("10000") },
        ],
      },
    ],
  }),
  category({
    id: "radioactivity",
    name: "Radioactivity",
    group: "Light & radiation",
    description: "Activity of radioactive sources.",
    keywords: "becquerel curie decay activity",
    baseUnit: "Bq",
    defaultFrom: "mCi",
    defaultTo: "MBq",
    presets: [
      ["mCi", "MBq"],
      ["pCi", "Bq"],
    ],
    notes: [],
    groups: [
      {
        group: "SI",
        source: "si",
        units: [
          ...prefixed({ id: "Bq", name: "becquerel", symbol: "Bq" }, ["T", "G", "M", "k"]),
          { id: "Bq", name: "becquerel", symbol: "Bq", aliases: ["becquerels"] },
        ],
      },
      {
        group: "Curie",
        source: "nist811",
        units: [
          { id: "Ci", name: "curie", symbol: "Ci", factor: ex("3.7e10"), aliases: ["curies"] },
          ...prefixed({ id: "Ci", name: "curie", symbol: "Ci", factor: ex("3.7e10") }, ["m", "µ", "n", "p"]).map((unit) => ({ ...unit, source: "nist811" as const })),
        ],
      },
    ],
  }),
  category({
    id: "absorbed-dose",
    name: "Absorbed dose",
    group: "Light & radiation",
    description: "Energy deposited by ionizing radiation (gray, rad).",
    keywords: "gray rad radiation dose",
    baseUnit: "Gy",
    defaultFrom: "rd",
    defaultTo: "Gy",
    presets: [["rd", "Gy"]],
    notes: [
      "Absorbed dose (Gy) and equivalent dose (Sv) are different quantities and are not interconverted.",
    ],
    groups: [
      {
        group: "Units",
        source: "si",
        units: [
          { id: "Gy", name: "gray", symbol: "Gy", aliases: ["grays"] },
          ...prefixed({ id: "Gy", name: "gray", symbol: "Gy" }, ["m", "µ"]),
          { id: "rd", name: "rad (absorbed dose)", symbol: "rd", factor: ex("0.01"), aliases: ["rad"], source: "nist811" },
          { id: "mrd", name: "millirad (absorbed dose)", symbol: "mrd", factor: ex("0.00001"), aliases: ["millirad"], source: "nist811" },
        ],
      },
    ],
  }),
  category({
    id: "equivalent-dose",
    name: "Equivalent dose",
    group: "Light & radiation",
    description: "Biological radiation dose (sievert, rem).",
    keywords: "sievert rem radiation exposure dose",
    baseUnit: "Sv",
    defaultFrom: "mrem",
    defaultTo: "uSv",
    presets: [
      ["mrem", "uSv"],
      ["rem", "mSv"],
    ],
    notes: [],
    groups: [
      {
        group: "Units",
        source: "si",
        units: [
          { id: "Sv", name: "sievert", symbol: "Sv", aliases: ["sieverts"] },
          ...prefixed({ id: "Sv", name: "sievert", symbol: "Sv" }, ["m", "µ"]),
          { id: "rem", name: "rem", symbol: "rem", factor: ex("0.01"), source: "nist811" },
          { id: "mrem", name: "millirem", symbol: "mrem", factor: ex("0.00001"), source: "nist811" },
        ],
      },
    ],
  }),
];

/** IEC binary prefixes (Ki = 2¹⁰ … Yi = 2⁸⁰). */
function binary(
  base: { id: string; name: string; symbol: string; factor?: Magnitude },
  count: number,
  aliases?: (prefix: string) => string[],
): UnitSpec[] {
  const names = ["kibi", "mebi", "gibi", "tebi", "pebi", "exbi", "zebi", "yobi"];
  const symbols = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei", "Zi", "Yi"];
  return names.slice(0, count).map((name, index) => ({
    id: symbols[index] + base.id,
    name: name + base.name,
    symbol: symbols[index] + base.symbol,
    factor: times(base.factor ?? ONE, frac(2n ** BigInt(10 * (index + 1)), 1n)),
    aliases: aliases?.(symbols[index]),
    source: "iec",
  }));
}

export const categoryGroups: CategoryGroup[] = [
  "Everyday",
  "Science & engineering",
  "Electricity & magnetism",
  "Digital",
  "Light & radiation",
];

const categoryById = new Map(unitCategories.map((item) => [item.id, item]));

export function getCategory(id: string): CategoryDefinition | undefined {
  return categoryById.get(id);
}

export function getUnit(
  categoryId: string,
  unitId: string,
): UnitDefinition | undefined {
  return getCategory(categoryId)?.units.find((unit) => unit.id === unitId);
}

export function unitCount() {
  return unitCategories.reduce((total, item) => total + item.units.length, 0);
}

export const popularConversions: {
  category: string;
  from: string;
  to: string;
}[] = [
  { category: "temperature", from: "degF", to: "degC" },
  { category: "length", from: "ft", to: "m" },
  { category: "mass", from: "lb", to: "kg" },
  { category: "volume", from: "cup_us", to: "mL" },
  { category: "speed", from: "mph", to: "km/h" },
  { category: "fuel-economy", from: "mpg_us", to: "L/100km" },
  { category: "data-storage", from: "GB", to: "GiB" },
  { category: "pressure", from: "psi", to: "bar" },
  { category: "energy", from: "kWh", to: "MJ" },
  { category: "torque", from: "lbf·ft", to: "N·m" },
];

// ---------------------------------------------------------------------------
// Number parsing (no eval)

export type ParseResult =
  | { ok: true; value: Rational }
  | { ok: false; error: string };

const VULGAR_FRACTIONS: Record<string, string> = {
  "½": "1/2",
  "⅓": "1/3",
  "⅔": "2/3",
  "¼": "1/4",
  "¾": "3/4",
  "⅕": "1/5",
  "⅖": "2/5",
  "⅗": "3/5",
  "⅘": "4/5",
  "⅙": "1/6",
  "⅚": "5/6",
  "⅐": "1/7",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
  "⅑": "1/9",
  "⅒": "1/10",
};
const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁻": "-",
  "⁺": "+",
};
const MAX_EXPONENT = 1000;
const MAX_NUMBER_LENGTH = 200;

const DECIMAL_PATTERN =
  /^(?:(\d{1,3}(?:,\d{3})+|\d+(?:_\d+)*)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+)|\s*[x×*·]\s*10\s*(?:\^\s*([+-]?\d+)|([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)))?$/;

function normalizeNumberText(text: string) {
  let value = text
    .normalize("NFC")
    .replace(/[−‒–—﹣－]/g, "-")
    .replace(/[    ]/g, " ")
    .replace(/⁄/g, "/")
    .trim()
    .replace(/\s+/g, " ");
  value = value.replace(
    /[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒]/g,
    (char) => ` ${VULGAR_FRACTIONS[char]}`,
  );
  return value.trim();
}

function parseUnsignedDecimal(text: string): ParseResult | null {
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return null;
  const [, whole, fraction = "", leadingFraction, expE, expCaret, expSup] =
    match;
  const intDigits = (whole ?? "0").replace(/[,_]/g, "");
  const fracDigits = leadingFraction ?? fraction;
  let exponentText = expE ?? expCaret ?? "0";
  if (expSup)
    exponentText = [...expSup].map((char) => SUPERSCRIPTS[char]).join("");
  if (!/^[+-]?\d+$/.test(exponentText)) return null;
  const exponent = Number(exponentText);
  if (Math.abs(exponent) > MAX_EXPONENT)
    return {
      ok: false,
      error: `That exponent is too large. Use an exponent between −${MAX_EXPONENT} and ${MAX_EXPONENT}.`,
    };
  let n = BigInt(intDigits + fracDigits);
  let d = pow10(fracDigits.length);
  if (exponent >= 0) n *= pow10(exponent);
  else d *= pow10(-exponent);
  return { ok: true, value: rational(n, d) };
}

/**
 * Parses decimals, thousands separators (1,234.5 or 1_234.5), fractions (3/4),
 * mixed numbers (1 1/2, 1½), and scientific notation (6.02e23, 1.5 × 10^3).
 */
export function parseNumber(text: string): ParseResult {
  if (text.length > MAX_NUMBER_LENGTH)
    return { ok: false, error: "That number is too long." };
  const value = normalizeNumberText(text);
  if (!value) return { ok: false, error: "Enter a number to convert." };
  if (/^[+-]?(?:inf(?:inity)?|∞|nan)$/i.test(value))
    return { ok: false, error: "Enter a finite number." };
  let rest = value;
  let negative = false;
  if (/^[+-]/.test(rest)) {
    negative = rest[0] === "-";
    rest = rest.slice(1).trimStart();
  }
  const sign = (r: Rational): ParseResult => ({
    ok: true,
    value: negative ? rational(-r.n, r.d) : r,
  });

  const mixed = /^(\d+) (\d+)\/(\d+)$/.exec(rest);
  if (mixed) {
    const denominator = BigInt(mixed[3]);
    if (denominator === 0n)
      return { ok: false, error: "A fraction can't have a denominator of 0." };
    return sign(
      add(rational(BigInt(mixed[1])), rational(BigInt(mixed[2]), denominator)),
    );
  }
  const slash = rest.indexOf("/");
  if (slash >= 0) {
    const top = parseUnsignedDecimal(rest.slice(0, slash).trim());
    const bottom = parseUnsignedDecimal(rest.slice(slash + 1).trim());
    if (top && bottom) {
      if (!top.ok) return top;
      if (!bottom.ok) return bottom;
      if (bottom.value.n === 0n)
        return {
          ok: false,
          error: "A fraction can't have a denominator of 0.",
        };
      return sign(div(top.value, bottom.value));
    }
  } else {
    const decimalValue = parseUnsignedDecimal(rest);
    if (decimalValue) return decimalValue.ok ? sign(decimalValue.value) : decimalValue;
  }
  if (/^\d+,\d{1,2}$|^\d+,\d{4,}$|^\d{1,3}(?:\.\d{3})+,\d+$/.test(rest))
    return {
      ok: false,
      error:
        "Use a period for decimals (1.5). Commas are only for grouping thousands (1,234.5).",
    };
  return {
    ok: false,
    error: `“${value}” isn't a number. Try 12.5, 3/4, 1 1/2, 1,234.5, or 6.02e23.`,
  };
}

// ---------------------------------------------------------------------------
// Conversion

export type ConversionResult =
  | { ok: true; value: Magnitude }
  | { ok: false; error: string };

function toBase(unit: UnitDefinition, value: Rational): Rational | string {
  if (unit.kind === "reciprocal") {
    if (value.n === 0n)
      return `0 ${unit.symbol} has no finite equivalent in distance-per-volume units.`;
    return div(unit.factor.value, value);
  }
  if (unit.kind === "affine")
    return mul(add(value, unit.offset?.value ?? ZERO_R), unit.factor.value);
  return mul(value, unit.factor.value);
}

function fromBase(unit: UnitDefinition, base: Rational): Rational | string {
  if (unit.kind === "reciprocal") {
    if (base.n === 0n)
      return `Zero can't be expressed in ${unit.symbol}.`;
    return div(unit.factor.value, base);
  }
  if (unit.kind === "affine")
    return sub(div(base, unit.factor.value), unit.offset?.value ?? ZERO_R);
  return div(base, unit.factor.value);
}

const unitExact = (unit: UnitDefinition) =>
  unit.factor.exact && (unit.offset?.exact ?? true);

function checkDomain(
  categoryDef: CategoryDefinition,
  base: Rational,
): string | null {
  const domain = categoryDef.domain;
  if (!domain) return null;
  const comparison = cmp(base, domain.min);
  if (comparison < 0 || (comparison === 0 && !domain.inclusive))
    return domain.message;
  return null;
}

/** Converts a value to the category's base unit, enforcing its domain. */
export function toBaseMagnitude(
  categoryDef: CategoryDefinition,
  unit: UnitDefinition,
  value: Magnitude,
): ConversionResult {
  const base = toBase(unit, value.value);
  if (typeof base === "string") return { ok: false, error: base };
  const domainError = checkDomain(categoryDef, base);
  if (domainError) return { ok: false, error: domainError };
  return { ok: true, value: { value: base, exact: value.exact && unitExact(unit) } };
}

export function fromBaseMagnitude(
  unit: UnitDefinition,
  base: Magnitude,
): ConversionResult {
  const result = fromBase(unit, base.value);
  if (typeof result === "string") return { ok: false, error: result };
  return { ok: true, value: { value: result, exact: base.exact && unitExact(unit) } };
}

export function convert(
  categoryId: string,
  fromId: string,
  toId: string,
  value: Rational | Magnitude,
): ConversionResult {
  const categoryDef = getCategory(categoryId);
  const from = categoryDef?.units.find((unit) => unit.id === fromId);
  const to = categoryDef?.units.find((unit) => unit.id === toId);
  if (!categoryDef || !from || !to)
    return { ok: false, error: "Choose units from the same category." };
  const input: Magnitude =
    "value" in value ? value : { value, exact: true };
  const base = toBaseMagnitude(categoryDef, from, input);
  if (!base.ok) return base;
  if (from.id === to.id) return { ok: true, value: input };
  return fromBaseMagnitude(to, base.value);
}

/** Convenience wrapper for tests and quick checks. */
export function convertNumber(
  categoryId: string,
  fromId: string,
  toId: string,
  input: string,
): number {
  const parsed = parseNumber(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const result = convert(categoryId, fromId, toId, parsed.value);
  if (!result.ok) throw new Error(result.error);
  return rationalToNumber(result.value.value);
}

// ---------------------------------------------------------------------------
// Formatting

export type Notation = "auto" | "decimal" | "scientific" | "engineering" | "fixed";
export type FormatOptions = {
  notation: Notation;
  /** Significant figures, or decimal places for fixed notation. */
  precision: number;
  grouping: boolean;
};
export type FormattedValue = {
  /** For display: grouped digits, Unicode minus, and × 10ⁿ. */
  text: string;
  /** For copying and CSV: plain ASCII, e notation, no grouping. */
  plain: string;
  /** True when the displayed value equals the exact result. */
  exact: boolean;
};

export const defaultFormat: FormatOptions = {
  notation: "auto",
  precision: 10,
  grouping: true,
};

function digitCount(value: bigint) {
  return value === 0n ? 1 : value.toString().length;
}

/** Rounds |r| to `digits` significant figures, half away from zero. */
function roundSignificant(r: Rational, digits: number) {
  const a = r.n < 0n ? -r.n : r.n;
  const d = r.d;
  let exponent = digitCount(a) - digitCount(d);
  const atLeast = (e: number) =>
    e >= 0 ? a >= d * pow10(e) : a * pow10(-e) >= d;
  if (!atLeast(exponent)) exponent -= 1;
  const shift = digits - 1 - exponent;
  const numerator = shift >= 0 ? a * pow10(shift) : a;
  const denominator = shift >= 0 ? d : d * pow10(-shift);
  let scaled = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) scaled += 1n;
  if (scaled === pow10(digits)) {
    scaled = pow10(digits - 1);
    exponent += 1;
  }
  return { digits: scaled.toString(), exponent, exact: remainder === 0n };
}

function superscript(value: number) {
  const map = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return String(value)
    .split("")
    .map((char) => (char === "-" ? "⁻" : map[Number(char)]))
    .join("");
}

function groupInteger(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function decimalFromDigits(digits: string, exponent: number) {
  // digits represent d.ddd × 10^exponent
  if (exponent >= 0) {
    const padded = digits.padEnd(exponent + 1, "0");
    return {
      integer: padded.slice(0, exponent + 1),
      fraction: padded.slice(exponent + 1),
    };
  }
  return { integer: "0", fraction: "0".repeat(-exponent - 1) + digits };
}

function joinDecimal(integer: string, fraction: string, grouping: boolean) {
  const grouped = grouping ? groupInteger(integer) : integer;
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function formatMagnitude(
  magnitude: Magnitude,
  options: FormatOptions = defaultFormat,
): FormattedValue {
  const { value } = magnitude;
  const negative = value.n < 0n;
  if (value.n === 0n)
    return { text: "0", plain: "0", exact: magnitude.exact };
  const sign = (text: string, plain: string, exact: boolean): FormattedValue => ({
    text: negative ? `−${text}` : text,
    plain: negative ? `-${plain}` : plain,
    exact: exact && magnitude.exact,
  });

  if (options.notation === "fixed") {
    const places = Math.max(0, Math.min(20, Math.round(options.precision)));
    const a = negative ? -value.n : value.n;
    const numerator = a * pow10(places);
    let scaled = numerator / value.d;
    const remainder = numerator % value.d;
    if (remainder * 2n >= value.d) scaled += 1n;
    const magnitudeDigits = digitCount(a / value.d);
    if (magnitudeDigits <= 40) {
      const raw = scaled.toString().padStart(places + 1, "0");
      const integer = raw.slice(0, raw.length - places);
      const fraction = raw.slice(raw.length - places);
      const isZero = scaled === 0n;
      const result = sign(
        joinDecimal(integer, fraction, options.grouping),
        joinDecimal(integer, fraction, false),
        remainder === 0n,
      );
      // Rounded to zero: avoid a misleading "−0.00".
      return isZero
        ? { text: result.text.replace("−", ""), plain: result.plain.replace("-", ""), exact: result.exact }
        : result;
    }
  }

  const precision = Math.max(1, Math.min(30, Math.round(options.precision)));
  const rounded = roundSignificant(value, precision);
  const digits = rounded.digits.replace(/0+$/, "") || "0";
  const exponent = rounded.exponent;
  let notation = options.notation;
  if (notation === "auto" || notation === "fixed")
    notation = exponent >= -6 && exponent < 12 ? "decimal" : "scientific";
  if (notation === "decimal" && Math.abs(exponent) > 40) notation = "scientific";

  if (notation === "decimal") {
    const { integer, fraction } = decimalFromDigits(digits, exponent);
    return sign(
      joinDecimal(integer, fraction, options.grouping),
      joinDecimal(integer, fraction, false),
      rounded.exact,
    );
  }

  let mantissaExponent = exponent;
  let integerDigits = 1;
  if (notation === "engineering") {
    mantissaExponent = Math.floor(exponent / 3) * 3;
    integerDigits = exponent - mantissaExponent + 1;
  }
  const padded = digits.padEnd(integerDigits, "0");
  const mantissa = joinDecimal(
    padded.slice(0, integerDigits),
    padded.slice(integerDigits),
    false,
  );
  return sign(
    `${mantissa} × 10${superscript(mantissaExponent)}`,
    `${mantissa}e${mantissaExponent}`,
    rounded.exact,
  );
}

/** Generated description such as "1 ft = 0.3048 m exactly". */
export function describeUnit(
  categoryDef: CategoryDefinition,
  unit: UnitDefinition,
): string {
  if (unit.definition) return unit.definition;
  const base = categoryDef.units.find((item) => item.id === categoryDef.baseUnit)!;
  if (unit.id === base.id) return `Base unit for ${categoryDef.name.toLowerCase()} conversions.`;
  const formatted = formatMagnitude(unit.factor, {
    notation: "auto",
    precision: 20,
    grouping: true,
  });
  return `1 ${unit.symbol} = ${formatted.text} ${base.symbol}${formatted.exact ? " exactly" : " (approx.)"}`;
}

/**
 * Formats a quantity as a mixed-unit expression such as "5 ft 10.5 in".
 * Unit ratios in a composite are integers, so carries are handled exactly.
 */
export function formatComposite(
  categoryDef: CategoryDefinition,
  unitIds: string[],
  base: Magnitude,
  decimals = 3,
): FormattedValue | null {
  const units = unitIds.map((id) =>
    categoryDef.units.find((unit) => unit.id === id),
  );
  if (units.some((unit) => !unit || unit.kind !== "linear")) return null;
  const linear = units as UnitDefinition[];
  const last = linear[linear.length - 1];
  const negative = base.value.n < 0n;
  const absolute = rational(negative ? -base.value.n : base.value.n, base.value.d);
  const inLast = div(absolute, last.factor.value);
  const scale = pow10(decimals);
  const numerator = inLast.n * scale;
  let total = numerator / inLast.d;
  const remainder = numerator % inLast.d;
  if (remainder * 2n >= inLast.d) total += 1n;
  const parts: { amount: bigint; unit: UnitDefinition }[] = [];
  for (const unit of linear.slice(0, -1)) {
    const ratio = div(unit.factor.value, last.factor.value);
    if (ratio.d !== 1n) return null;
    const step = ratio.n * scale;
    parts.push({ amount: total / step, unit });
    total %= step;
  }
  const lastInteger = total / scale;
  const lastFraction = (total % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const lastText = lastFraction ? `${lastInteger}.${lastFraction}` : `${lastInteger}`;
  const firstNonZero = parts.findIndex((part) => part.amount !== 0n);
  const shown = firstNonZero === -1 ? [] : parts.slice(firstNonZero);
  const pieces = [
    ...shown.map((part) => `${part.amount} ${part.unit.symbol}`),
    `${lastText} ${last.symbol}`,
  ];
  const text = pieces.join(" ");
  const isZero = shown.length === 0 && /^0(\.0*)?$/.test(lastText);
  const prefix = negative && !isZero;
  return {
    text: prefix ? `−${text}` : text,
    plain: prefix ? `-${text}` : text,
    exact: remainder === 0n && base.exact && linear.every(unitExact),
  };
}

// ---------------------------------------------------------------------------
// Unit lookup for typed queries

type UnitRef = { category: CategoryDefinition; unit: UnitDefinition };

function compact(text: string) {
  return text
    .replace(/[º˚]/g, "°")
    .normalize("NFKC")
    .replace(/[μµ]/g, "u")
    .replace(/\s+per\s+/gi, "/")
    .replace(/[\s.·⋅•*\-_^()]/g, "");
}

function singularWord(word: string) {
  if (word === "feet") return "foot";
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(ss|us)$/.test(word)) return word.slice(0, -1);
  return word;
}

function singular(text: string) {
  return compact(
    text
      .toLowerCase()
      .replace(/\s+per\s+/g, " / ")
      .replace(/[a-z]+/g, singularWord),
  );
}

const STAGE_EXACT = 0;
const STAGE_FOLDED = 1;
const STAGE_SINGULAR = 2;
const lookupIndexes = [
  new Map<string, UnitRef[]>(),
  new Map<string, UnitRef[]>(),
  new Map<string, UnitRef[]>(),
];

function indexKey(stage: number, key: string, ref: UnitRef) {
  if (!key) return;
  const map = lookupIndexes[stage];
  const list = map.get(key) ?? [];
  if (!list.some((item) => item.unit === ref.unit && item.category === ref.category))
    list.push(ref);
  map.set(key, list);
}

for (const categoryDef of unitCategories) {
  for (const unit of categoryDef.units) {
    const ref = { category: categoryDef, unit };
    const strong = [unit.symbol, unit.name, ...unit.aliases];
    for (const label of strong) {
      indexKey(STAGE_EXACT, compact(label), ref);
      indexKey(STAGE_FOLDED, compact(label).toLowerCase(), ref);
    }
    for (const label of unit.looseAliases)
      indexKey(STAGE_FOLDED, compact(label).toLowerCase(), ref);
    for (const label of [unit.name, ...unit.aliases.filter((alias) => alias.length > 3)])
      indexKey(STAGE_SINGULAR, singular(label), ref);
  }
}

/** Tokens that look like units but are too ambiguous to guess. */
const AMBIGUOUS_TOKENS: Record<string, string> = {
  KB: "“KB” can mean 1000 bytes (kB) or 1024 bytes (KiB). Enter kB or KiB.",
};

type CategoryMatch = { stage: number; units: UnitDefinition[] };

function unitMatches(token: string): Map<CategoryDefinition, CategoryMatch> {
  const result = new Map<CategoryDefinition, CategoryMatch>();
  const keys = [compact(token), compact(token).toLowerCase(), singular(token)];
  keys.forEach((key, stage) => {
    for (const ref of lookupIndexes[stage].get(key) ?? []) {
      const existing = result.get(ref.category);
      if (existing && existing.stage < stage) continue;
      if (existing && existing.stage === stage) {
        if (!existing.units.includes(ref.unit)) existing.units.push(ref.unit);
      } else result.set(ref.category, { stage, units: [ref.unit] });
    }
  });
  return result;
}

export type UnitResolution =
  | { ok: true; category: CategoryDefinition; units: UnitDefinition[] }
  | { ok: false; error: string };

/** Resolves unit names so that all of them belong to one category. */
export function resolveUnits(
  tokens: string[],
  preferCategory?: string,
): UnitResolution {
  const matches: Map<CategoryDefinition, CategoryMatch>[] = [];
  for (const token of tokens) {
    const ambiguous = AMBIGUOUS_TOKENS[compact(token)];
    if (ambiguous) return { ok: false, error: ambiguous };
    const found = unitMatches(token);
    if (!found.size) return { ok: false, error: `Unknown unit “${token}”.` };
    matches.push(found);
  }
  const shared = [...matches[0].keys()].filter((item) =>
    matches.every((match) => match.has(item)),
  );
  if (!shared.length) {
    const describe = (token: string, match: Map<CategoryDefinition, CategoryMatch>) =>
      `${token} (${[...match.keys()].map((item) => item.name.toLowerCase()).join(" or ")})`;
    return {
      ok: false,
      error: `Can't convert between ${tokens.map((token, index) => describe(token, matches[index])).join(" and ")}.`,
    };
  }
  const score = (item: CategoryDefinition) =>
    matches.reduce((total, match) => total + match.get(item)!.stage, 0);
  const best = Math.min(...shared.map(score));
  let candidates = shared.filter((item) => score(item) === best);
  if (candidates.length > 1 && preferCategory) {
    const preferred = candidates.find((item) => item.id === preferCategory);
    if (preferred) candidates = [preferred];
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      error: `“${tokens.join(" … ")}” could be ${candidates
        .map((item) => item.name.toLowerCase())
        .join(" or ")}. Use a more specific unit name.`,
    };
  }
  const chosen = candidates[0];
  const units: UnitDefinition[] = [];
  for (const [index, match] of matches.entries()) {
    const options = match.get(chosen)!.units;
    if (options.length > 1) {
      return {
        ok: false,
        error: `“${tokens[index]}” could mean ${options
          .map((unit) => `${unit.name} (${unit.symbol})`)
          .join(", ")}. Choose one of those.`,
      };
    }
    units.push(options[0]);
  }
  return { ok: true, category: chosen, units };
}

// ---------------------------------------------------------------------------
// Typed queries: "5 ft 3 in to cm", "72°F in C", "1 1/2 US cups"

export type QueryResult =
  | { ok: true; kind: "number"; value: Rational }
  | {
      ok: true;
      kind: "quantity";
      category: CategoryDefinition;
      /** The unit the value is expressed in (the last unit typed). */
      from: UnitDefinition;
      value: Magnitude;
      to?: UnitDefinition;
      result?: Magnitude;
      /** True for mixed input such as "5 ft 3 in". */
      combined: boolean;
    }
  | { ok: false; error: string };

function spaceOut(text: string) {
  return text
    .replace(/(['′"″])(?=\s*[\d.])/g, "$1 ")
    .replace(
      /(\d)(?![eE][+-]?\d)(?![x×*·]\s*10)(?=[^\d\s.,/_^⁰¹²³⁴⁵⁶⁷⁸⁹½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])/g,
      "$1 ",
    )
    .replace(/([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])(?=[^\s])/g, "$1 ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

type Term = { value: Rational; unitText: string };

function parseTerms(
  text: string,
): { ok: true; terms: Term[] } | { ok: true; number: Rational } | { ok: false; error: string } {
  const tokens = spaceOut(normalizeNumberText(text));
  const isNumber = (token: string) => parseNumber(token).ok;
  // Re-join "x 10^3" style scientific notation split by spaces.
  const terms: Term[] = [];
  let index = 0;
  while (index < tokens.length) {
    let parsed: ParseResult | null = null;
    let used = 0;
    for (const length of [4, 3, 2, 1]) {
      if (index + length > tokens.length) continue;
      const candidate = tokens.slice(index, index + length).join(" ");
      const attempt = parseNumber(candidate);
      if (attempt.ok) {
        parsed = attempt;
        used = length;
        break;
      }
      if (length === 1) parsed = attempt;
    }
    if (!parsed || !parsed.ok)
      return {
        ok: false,
        error: terms.length
          ? `Expected a number before “${tokens[index]}”.`
          : parsed?.error ?? "Start with a number.",
      };
    index += used;
    const unitTokens: string[] = [];
    while (index < tokens.length && !isNumber(tokens[index])) {
      unitTokens.push(tokens[index]);
      index += 1;
    }
    if (!unitTokens.length) {
      if (!terms.length && index >= tokens.length)
        return { ok: true, number: parsed.value };
      return { ok: false, error: "Add a unit after each number, like 5 ft 3 in." };
    }
    terms.push({ value: parsed.value, unitText: unitTokens.join(" ") });
  }
  if (!terms.length) return { ok: false, error: "Enter a number to convert." };
  return { ok: true, terms };
}

function splitTarget(text: string): [string, string | null][] {
  const options: [string, string | null][] = [];
  const explicit = /\s*(?:\bto\b|\binto\b|\bas\b|->|→|=>|=)\s*/gi;
  const explicitMatches = [...text.matchAll(explicit)];
  if (explicitMatches.length) {
    const last = explicitMatches[explicitMatches.length - 1];
    options.push([text.slice(0, last.index), text.slice(last.index + last[0].length)]);
  }
  // "in" may also be the inch, so try each standalone "in" from the right.
  const inMatches = [...text.matchAll(/(?<=\s)in(?=\s)/gi)].reverse();
  for (const match of inMatches)
    options.push([text.slice(0, match.index), text.slice(match.index + 2)]);
  options.push([text, null]);
  return options;
}

export function parseConversionQuery(
  text: string,
  options: { preferCategory?: string; defaultTo?: string } = {},
): QueryResult {
  const input = text.trim();
  if (!input) return { ok: false, error: "Enter a value, like 5 ft 3 in to cm." };
  if (input.length > 300) return { ok: false, error: "That line is too long." };
  let firstError: string | null = null;
  for (const [left, right] of splitTarget(input)) {
    const target = right?.trim();
    if (right !== null && !target) continue;
    const parsed = parseTerms(left);
    if (!parsed.ok) {
      firstError ??= parsed.error;
      continue;
    }
    if ("number" in parsed) {
      if (target) {
        firstError ??= "Add a unit after the number, like 5 ft to m.";
        continue;
      }
      return { ok: true, kind: "number", value: parsed.number };
    }
    const tokens = parsed.terms.map((term) => term.unitText);
    if (target) tokens.push(target);
    const resolved = resolveUnits(tokens, options.preferCategory);
    if (!resolved.ok) {
      firstError ??= resolved.error;
      continue;
    }
    const { category: categoryDef } = resolved;
    const termUnits = resolved.units.slice(0, parsed.terms.length);
    const to = target ? resolved.units[resolved.units.length - 1] : undefined;
    const combined = parsed.terms.length > 1;
    if (combined && termUnits.some((unit) => unit.kind !== "linear"))
      return {
        ok: false,
        error: "Only simple units can be combined, like 5 ft 3 in or 2 lb 4 oz.",
      };
    const from = termUnits[termUnits.length - 1];
    let value: Magnitude;
    let base: ConversionResult;
    if (combined) {
      let total = ZERO_R;
      for (const [index, term] of parsed.terms.entries())
        total = add(total, mul(term.value, termUnits[index].factor.value));
      const exact = termUnits.every(unitExact);
      base = toBaseMagnitude(
        categoryDef,
        categoryDef.units.find((unit) => unit.id === categoryDef.baseUnit)!,
        { value: total, exact },
      );
      if (!base.ok) return base;
      const inFrom = fromBaseMagnitude(from, base.value);
      if (!inFrom.ok) return inFrom;
      value = inFrom.value;
    } else {
      value = { value: parsed.terms[0].value, exact: true };
      base = toBaseMagnitude(categoryDef, from, value);
      if (!base.ok) return base;
    }
    let toUnit = to;
    if (!toUnit && options.defaultTo)
      toUnit = categoryDef.units.find((unit) => unit.id === options.defaultTo);
    let result: Magnitude | undefined;
    if (toUnit) {
      const converted = fromBaseMagnitude(toUnit, base.value);
      if (!converted.ok) return converted;
      result = converted.value;
    }
    return {
      ok: true,
      kind: "quantity",
      category: categoryDef,
      from,
      value,
      to: toUnit,
      result,
      combined,
    };
  }
  return { ok: false, error: firstError ?? "Couldn't read that conversion." };
}

// ---------------------------------------------------------------------------
// Search

export type UnitSearchResult = {
  category: CategoryDefinition;
  unit?: UnitDefinition;
  score: number;
};

export function searchUnits(query: string, limit = 40): UnitSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const compactNeedle = compact(needle).toLowerCase();
  const results: UnitSearchResult[] = [];
  const rank = (haystacks: string[]) => {
    let best = Infinity;
    for (const haystack of haystacks) {
      const lower = haystack.toLowerCase();
      const compacted = compact(lower).toLowerCase();
      if (lower === needle || compacted === compactNeedle) best = Math.min(best, 0);
      else if (lower.startsWith(needle) || compacted.startsWith(compactNeedle))
        best = Math.min(best, 1);
      else if (lower.includes(needle)) best = Math.min(best, 2);
    }
    return best;
  };
  for (const categoryDef of unitCategories) {
    const categoryScore = rank([categoryDef.name, ...categoryDef.keywords.split(" ")]);
    if (categoryScore < Infinity)
      results.push({ category: categoryDef, score: categoryScore + 0.5 });
    for (const unit of categoryDef.units) {
      const score = rank([unit.symbol, unit.name, ...unit.aliases]);
      if (score < Infinity) results.push({ category: categoryDef, unit, score });
    }
  }
  return results
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Batch conversion and CSV

export type BatchRow = {
  line: number;
  input: string;
  ok: boolean;
  value?: FormattedValue;
  from?: UnitDefinition;
  result?: FormattedValue;
  to?: UnitDefinition;
  error?: string;
};

export const MAX_BATCH_LINES = 2000;

/**
 * Converts one value per line. A bare number uses the selected units; a line
 * with units ("5 ft 3 in", "12 psi to kPa") is read as its own conversion and
 * defaults to the selected target unit when compatible.
 */
export function convertBatch(
  text: string,
  selection: { category: string; from: string; to: string },
  format: FormatOptions = defaultFormat,
): { rows: BatchRow[]; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  const rows: BatchRow[] = [];
  let truncated = false;
  for (const [index, raw] of lines.entries()) {
    const input = raw.trim();
    if (!input) continue;
    if (rows.length >= MAX_BATCH_LINES) {
      truncated = true;
      break;
    }
    const line = index + 1;
    const categoryDef = getCategory(selection.category);
    const query = parseConversionQuery(input, {
      preferCategory: selection.category,
      defaultTo: selection.to,
    });
    if (!query.ok) {
      rows.push({ line, input, ok: false, error: query.error });
      continue;
    }
    if (query.kind === "number") {
      const from = getUnit(selection.category, selection.from);
      const to = getUnit(selection.category, selection.to);
      const converted = convert(selection.category, selection.from, selection.to, query.value);
      if (!converted.ok || !from || !to || !categoryDef) {
        rows.push({ line, input, ok: false, error: converted.ok ? "Choose units." : converted.error });
        continue;
      }
      rows.push({
        line,
        input,
        ok: true,
        value: formatMagnitude({ value: query.value, exact: true }, format),
        from,
        result: formatMagnitude(converted.value, format),
        to,
      });
      continue;
    }
    let to = query.to;
    let result = query.result;
    if (!to) {
      to = query.category.units.find((unit) => unit.id === query.category.defaultTo)!;
      const converted = convert(query.category.id, query.from.id, to.id, query.value);
      if (!converted.ok) {
        rows.push({ line, input, ok: false, error: converted.error });
        continue;
      }
      result = converted.value;
    }
    rows.push({
      line,
      input,
      ok: true,
      value: formatMagnitude(query.value, format),
      from: query.from,
      result: result && formatMagnitude(result, format),
      to,
    });
  }
  return { rows, truncated };
}

function csvCell(value: string, numeric = false) {
  let cell = value;
  // Neutralize spreadsheet formulas in free-text cells.
  if (!numeric && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function batchToCsv(rows: BatchRow[]): string {
  const header = ["Line", "Input", "Value", "From unit", "Result", "To unit", "Exact", "Error"];
  const body = rows.map((row) =>
    [
      String(row.line),
      csvCell(row.input),
      csvCell(row.value?.plain ?? "", true),
      csvCell(row.from?.symbol ?? ""),
      csvCell(row.result?.plain ?? "", true),
      csvCell(row.to?.symbol ?? ""),
      row.ok ? (row.result?.exact ? "yes" : "no") : "",
      csvCell(row.error ?? ""),
    ].join(","),
  );
  return [header.join(","), ...body].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Shareable state

export type ConverterSelection = {
  category: string;
  from: string;
  to: string;
  value: string;
  retained?: Magnitude;
};

export function selectionFromSearch(search: string): Partial<ConverterSelection> {
  const params = new URLSearchParams(search);
  const categoryDef = getCategory(params.get("category") ?? "");
  if (!categoryDef) return {};
  const has = (id: string | null) =>
    id !== null && categoryDef.units.some((unit) => unit.id === id);
  const from = params.get("from");
  const to = params.get("to");
  const value = params.get("value");
  const numerator = params.get("n");
  const denominator = params.get("d");
  let retained: Magnitude | undefined;
  // Bound BigInt work and only restore a snapshot matching the displayed input.
  if (value && value.length <= MAX_NUMBER_LENGTH && numerator && denominator &&
      numerator.length <= 2500 && denominator.length <= 2500 &&
      /^-?\d+$/.test(numerator) && /^\d+$/.test(denominator) && /[1-9]/.test(denominator)) {
    const candidate = {
      value: rational(BigInt(numerator), BigInt(denominator)),
      exact: params.get("approximate") !== "1",
    };
    if (editableValue(candidate) === value) retained = candidate;
  }
  return {
    category: categoryDef.id,
    from: has(from) ? from! : categoryDef.defaultFrom,
    to: has(to) ? to! : categoryDef.defaultTo,
    ...(value !== null && value.length <= MAX_NUMBER_LENGTH ? { value } : {}),
    ...(retained ? { retained } : {}),
  };
}

export function selectionToSearch(selection: ConverterSelection): string {
  const params = new URLSearchParams({
    category: selection.category,
    from: selection.from,
    to: selection.to,
  });
  if (selection.value.trim()) params.set("value", selection.value.trim());
  if (selection.retained && editableValue(selection.retained) === selection.value.trim()) {
    params.set("n", selection.retained.value.n.toString());
    params.set("d", selection.retained.value.d.toString());
    if (!selection.retained.exact) params.set("approximate", "1");
  }
  return `?${params.toString()}`;
}

/** Plain value suitable for an input box (exact when it terminates briefly). */
export function editableValue(magnitude: Magnitude): string {
  const formatted = formatMagnitude(magnitude, {
    notation: "auto",
    precision: 15,
    grouping: false,
  });
  return formatted.plain;
}
