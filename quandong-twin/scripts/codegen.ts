/**
 * Contract code generator.
 *
 * Reads the Open Data Contract Standard (ODCS) v3.2 contracts in `contracts/` and the shared
 * reference file, validates them, and writes:
 *   - generator/src/contracts/generated.ts        TypeScript event types, field lists, enums
 *   - generator/src/contracts/reference.generated.ts  shared operational reference values
 *   - contracts/generated/jsonschema/<feed>.schema.json  JSON Schema per event (contract tests)
 *   - lakehouse/src/quandong/contracts_generated.py  Spark schema hints, columns, expectations
 *
 * Usage: node scripts/codegen.ts [--check]
 *   --check  regenerate in memory and fail if any committed file differs (used in CI).
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Ajv2019 } from "ajv/dist/2019.js";
import addFormatsModule from "ajv-formats";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "contracts");
const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------------------------------------
// Types for the subset of ODCS we use
// ---------------------------------------------------------------------------------------------
interface EnumValue {
  value: string | number;
  description?: string;
}
interface Quality {
  id: string;
  type: string;
  engine?: string;
  implementation?: string;
  severity?: string;
  description?: string;
}
interface Property {
  name: string;
  logicalType: string;
  physicalType: string;
  required?: boolean;
  description?: string;
  logicalTypeOptions?: Record<string, string | number>;
  enum?: EnumValue[];
  items?: { logicalType: string; physicalType: string };
  quality?: Quality[];
}
interface Contract {
  apiVersion: string;
  id: string;
  name: string;
  version: string;
  tags?: string[];
  customProperties?: { property: string; value: string }[];
  schema: { name: string; properties: Property[]; quality?: Quality[] }[];
}
interface Expectation {
  name: string;
  expr: string;
}
interface Feed {
  name: string;
  version: string;
  restricted: boolean;
  landingFolder: string;
  properties: Property[];
  drop: Expectation[];
  warn: Expectation[];
}

// ---------------------------------------------------------------------------------------------
// Load and validate
// ---------------------------------------------------------------------------------------------
const errors: string[] = [];
const fail = (msg: string): void => {
  errors.push(msg);
};

const odcsSchema = JSON.parse(
  readFileSync(join(CONTRACTS, "vendor", "odcs-json-schema-v3.2.0.json"), "utf8"),
) as object;
const ajv = new Ajv2019({ allErrors: true, strict: false });
const addFormats = addFormatsModule as unknown as (a: Ajv2019) => void;
addFormats(ajv);
const validateOdcs = ajv.compile(odcsSchema);

const common = (parse(readFileSync(join(CONTRACTS, "common.yaml"), "utf8")) as { properties: Property[] })
  .properties;

const contractFiles = readdirSync(CONTRACTS)
  .filter((f) => f.endsWith(".odcs.yaml"))
  .sort();

const sqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

function expectationsFor(feedName: string, props: Property[], schemaQuality: Quality[]): {
  drop: Expectation[];
  warn: Expectation[];
} {
  const drop: Expectation[] = [];
  const warn: Expectation[] = [];
  for (const p of props) {
    const nullable = (expr: string): string => (p.required ? expr : `${p.name} IS NULL OR ${expr}`);
    if (p.required) drop.push({ name: `${p.name}_not_null`, expr: `${p.name} IS NOT NULL` });
    if (p.name === "feed") drop.push({ name: "feed_matches", expr: `feed = ${sqlString(feedName)}` });
    if (p.enum) {
      const values = p.enum.map((e) => (typeof e.value === "number" ? String(e.value) : sqlString(e.value)));
      drop.push({ name: `${p.name}_valid_value`, expr: nullable(`${p.name} IN (${values.join(", ")})`) });
    }
    const o = p.logicalTypeOptions ?? {};
    if (typeof o.pattern === "string") {
      // Raw string literal so regex backslashes reach the Java regex engine unchanged.
      drop.push({ name: `${p.name}_pattern`, expr: nullable(`${p.name} RLIKE r${sqlString(o.pattern)}`) });
    }
    if (o.minimum !== undefined && o.maximum !== undefined) {
      drop.push({ name: `${p.name}_range`, expr: nullable(`${p.name} BETWEEN ${o.minimum} AND ${o.maximum}`) });
    } else if (o.minimum !== undefined) {
      drop.push({ name: `${p.name}_min`, expr: nullable(`${p.name} >= ${o.minimum}`) });
    } else if (o.maximum !== undefined) {
      drop.push({ name: `${p.name}_max`, expr: nullable(`${p.name} <= ${o.maximum}`) });
    }
    for (const q of p.quality ?? []) schemaQuality.push(q);
  }
  for (const q of schemaQuality) {
    if (q.type !== "custom" || q.engine !== "databricks-expectation" || !q.implementation) continue;
    const target = q.severity === "error" ? drop : q.severity === "warning" ? warn : undefined;
    if (!target) {
      fail(`${feedName}: quality rule ${q.id} must have severity error or warning`);
      continue;
    }
    target.push({ name: q.id, expr: q.implementation });
  }
  const names = new Set<string>();
  for (const e of [...drop, ...warn]) {
    if (names.has(e.name)) fail(`${feedName}: duplicate expectation name ${e.name}`);
    names.add(e.name);
  }
  return { drop, warn };
}

const feeds: Feed[] = [];
for (const file of contractFiles) {
  const raw = parse(readFileSync(join(CONTRACTS, file), "utf8")) as Contract;
  if (!validateOdcs(raw)) {
    fail(`${file}: not valid ODCS v3.2.0: ${ajv.errorsText(validateOdcs.errors, { separator: "; " })}`);
    continue;
  }
  if (raw.apiVersion !== "v3.2.0") fail(`${file}: apiVersion must be v3.2.0`);
  const obj = raw.schema[0];
  if (!obj || raw.schema.length !== 1) {
    fail(`${file}: exactly one schema object expected`);
    continue;
  }
  if (obj.name !== raw.name || `${raw.name}.odcs.yaml` !== file) fail(`${file}: name mismatch`);
  // Envelope must match common.yaml exactly, in order, at the start of the property list.
  common.forEach((c, i) => {
    if (JSON.stringify(obj.properties[i]) !== JSON.stringify(c)) {
      fail(`${file}: property #${i + 1} must equal common envelope field ${c.name}`);
    }
  });
  const custom = Object.fromEntries((raw.customProperties ?? []).map((c) => [c.property, c.value]));
  const { drop, warn } = expectationsFor(raw.name, obj.properties, [...(obj.quality ?? [])]);
  feeds.push({
    name: raw.name,
    version: raw.version,
    restricted: (raw.tags ?? []).includes("restricted"),
    landingFolder: custom.landingFolder ?? raw.name,
    properties: obj.properties,
    drop,
    warn,
  });
}

const reference = parse(readFileSync(join(CONTRACTS, "reference", "ot_reference.yaml"), "utf8")) as Record<
  string,
  unknown
>;

if (errors.length) {
  console.error(errors.map((e) => `✖ ${e}`).join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------------------------
const HEADER = "GENERATED by scripts/codegen.ts from contracts/ — do not edit. Run `npm run gen`.";
const pascal = (s: string): string => s.replace(/(^|_)([a-z])/g, (_m, _u, c: string) => c.toUpperCase());

function tsType(p: Property, feedName: string): string {
  let t: string;
  if (p.name === "feed") t = JSON.stringify(feedName);
  else if (p.enum) t = p.enum.map((e) => JSON.stringify(e.value)).join(" | ");
  else if (p.logicalType === "integer" || p.logicalType === "number") t = "number";
  else if (p.logicalType === "boolean") t = "boolean";
  else if (p.logicalType === "array") t = "string[]";
  else t = "string"; // string, timestamp (ISO 8601), date (yyyy-MM-dd)
  return p.required ? t : `${t} | null`;
}

function emitTs(): string {
  const publicFeeds = feeds.filter((f) => !f.restricted);
  const out: string[] = [`// ${HEADER}`, ""];
  out.push(`export const FEEDS = [${publicFeeds.map((f) => JSON.stringify(f.name)).join(", ")}] as const;`);
  out.push("export type Feed = (typeof FEEDS)[number];");
  out.push(`export const ALL_STREAMS = [...FEEDS, "scenario_log"] as const;`);
  out.push("export type Stream = (typeof ALL_STREAMS)[number];", "");
  out.push("export const SCHEMA_VERSION: Record<Stream, string> = {");
  for (const f of feeds) out.push(`  ${f.name}: ${JSON.stringify(f.version)},`);
  out.push("};", "");
  out.push("/** Folder under the landing volume each stream is written to. */");
  out.push("export const LANDING_FOLDER: Record<Stream, string> = {");
  for (const f of feeds) out.push(`  ${f.name}: ${JSON.stringify(f.landingFolder)},`);
  out.push("};", "");
  out.push("/** Field order per stream, as declared in the contract. */");
  out.push("export const FIELDS: Record<Stream, readonly string[]> = {");
  for (const f of feeds) out.push(`  ${f.name}: [${f.properties.map((p) => JSON.stringify(p.name)).join(", ")}],`);
  out.push("};", "");
  out.push("/** Envelope fields carried by every event. */");
  out.push("export interface Envelope {");
  for (const p of common) out.push(`  /** ${p.description ?? ""} */`, `  ${p.name}: string;`);
  out.push("}", "");
  for (const f of feeds) {
    out.push(`/** \`${f.name}\` event (contract version ${f.version}). */`);
    out.push(`export interface ${pascal(f.name)}Event extends Envelope {`);
    for (const p of f.properties) {
      if (common.some((c) => c.name === p.name) && p.name !== "feed") continue;
      out.push(`  /** ${(p.description ?? "").replace(/\*\//g, "*\\/")} */`);
      out.push(`  ${p.name}: ${tsType(p, f.name)};`);
    }
    out.push("}", "");
  }
  out.push("export interface StreamEvents {");
  for (const f of feeds) out.push(`  ${f.name}: ${pascal(f.name)}Event;`);
  out.push("}");
  out.push("export type AnyEvent = StreamEvents[Stream];", "");
  return out.join("\n");
}

function emitReferenceTs(): string {
  return `// ${HEADER}\n\nexport const REFERENCE = ${JSON.stringify(reference, null, 2)} as const;\n`;
}

function jsonSchemaFor(f: Feed): object {
  const properties: Record<string, object> = {};
  for (const p of f.properties) {
    const s: Record<string, unknown> = { description: p.description };
    const o = p.logicalTypeOptions ?? {};
    if (p.name === "feed") s.const = f.name;
    else if (p.enum) s.enum = p.enum.map((e) => e.value);
    else if (p.logicalType === "integer") s.type = "integer";
    else if (p.logicalType === "number") s.type = "number";
    else if (p.logicalType === "array") Object.assign(s, { type: "array", items: { type: "string" } });
    else s.type = "string";
    if (p.logicalType === "timestamp") s.pattern = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
    if (p.logicalType === "date") s.pattern = "^\\d{4}-\\d{2}-\\d{2}$";
    if (typeof o.pattern === "string") s.pattern = o.pattern;
    if (o.minimum !== undefined) s.minimum = o.minimum;
    if (o.maximum !== undefined) s.maximum = o.maximum;
    if (!p.required) {
      if (s.enum) s.enum = [...(s.enum as unknown[]), null];
      else if (s.type) s.type = [s.type, "null"];
    }
    properties[p.name] = s;
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://quandong.example/contracts/${f.name}/${f.version}`,
    title: f.name,
    description: HEADER,
    type: "object",
    additionalProperties: false,
    // Every field is always present; optional fields are null rather than absent.
    required: f.properties.map((p) => p.name),
    properties,
  };
}

function py(v: unknown, indent = 0): string {
  const pad = " ".repeat(indent + 4);
  const end = " ".repeat(indent);
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (!v.length) return "()";
    return `(\n${v.map((x) => `${pad}${py(x, indent + 4)},`).join("\n")}\n${end})`;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${py(x, indent + 4)},`).join("\n")}\n${end}}`;
}

function bronzeType(p: Property): string {
  // Bronze keeps timestamps and dates as raw strings; silver parses them.
  return p.logicalType === "timestamp" || p.logicalType === "date" ? "STRING" : p.physicalType;
}

function emitPy(): string {
  const publicFeeds = feeds.filter((f) => !f.restricted).map((f) => f.name);
  const byFeed = <T>(fn: (f: Feed) => T): Record<string, T> => Object.fromEntries(feeds.map((f) => [f.name, fn(f)]));
  const parts = [
    `"""${HEADER}"""`,
    "",
    "# ruff: noqa: E501",
    "",
    `FEEDS = ${py(publicFeeds)}`,
    `RESTRICTED_STREAMS = ${py(feeds.filter((f) => f.restricted).map((f) => f.name))}`,
    "",
    `SCHEMA_VERSION = ${py(byFeed((f) => f.version))}`,
    "",
    `LANDING_FOLDER = ${py(byFeed((f) => f.landingFolder))}`,
    "",
    "# (name, physical Spark type, logical type, required) in contract order.",
    `COLUMNS = ${py(byFeed((f) => f.properties.map((p) => [p.name, p.physicalType, p.logicalType, !!p.required])))}`,
    "",
    "# Auto Loader schema hints for bronze (timestamps and dates stay as raw strings).",
    `BRONZE_SCHEMA_HINTS = ${py(byFeed((f) => f.properties.map((p) => `\`${p.name}\` ${bronzeType(p)}`).join(", ")))}`,
    "",
    "# Structural failures: rows are dropped in silver (expect_or_drop).",
    `EXPECT_OR_DROP = ${py(byFeed((f) => Object.fromEntries(f.drop.map((e) => [e.name, e.expr]))))}`,
    "",
    "# Physical-range and consistency warnings: rows are kept and counted (expect).",
    `EXPECT_WARN = ${py(byFeed((f) => Object.fromEntries(f.warn.map((e) => [e.name, e.expr]))))}`,
    "",
    `REFERENCE = ${py(reference)}`,
    "",
  ];
  return parts.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Write or check
// ---------------------------------------------------------------------------------------------
const outputs = new Map<string, string>();
outputs.set("generator/src/contracts/generated.ts", emitTs());
outputs.set("generator/src/contracts/reference.generated.ts", emitReferenceTs());
outputs.set("lakehouse/src/quandong/contracts_generated.py", emitPy());
for (const f of feeds) {
  outputs.set(`contracts/generated/jsonschema/${f.name}.schema.json`, `${JSON.stringify(jsonSchemaFor(f), null, 2)}\n`);
}

let drift = 0;
for (const [rel, content] of outputs) {
  const abs = join(ROOT, rel);
  if (CHECK) {
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    if (current !== content) {
      console.error(`✖ out of date: ${rel}`);
      drift++;
    }
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}
if (CHECK && drift) {
  console.error("Generated files are out of date. Run `npm run gen`.");
  process.exit(1);
}
console.log(`${CHECK ? "checked" : "generated"} ${outputs.size} files from ${feeds.length} contracts`);
