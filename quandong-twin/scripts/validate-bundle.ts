/**
 * Offline check of the Databricks bundle (no workspace or credentials needed):
 *   1. merges lakehouse/databricks.yml with its included resource files,
 *   2. validates the result against the bundle JSON Schema published with the Databricks CLI,
 *   3. checks that referenced paths exist and the dashboard only queries tables the pipeline defines.
 *
 *   npm run bundle:check [-- --schema path/to/jsonschema.json]
 *
 * The schema is downloaded once to out/.cache. `databricks bundle validate` (which needs a
 * workspace login) remains the authoritative check; run it before deploying.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { Ajv } from "ajv";

const ROOT = resolve(import.meta.dirname, "..");
const BUNDLE = join(ROOT, "lakehouse");
const SCHEMA_URL = "https://raw.githubusercontent.com/databricks/cli/main/bundle/schema/jsonschema.json";
const args = process.argv.slice(2);
const schemaArg = args.includes("--schema") ? args[args.indexOf("--schema") + 1] : undefined;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
function merge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(out[k]) && isObj(v) ? merge(out[k], v) : v;
  return out;
}

const errors: string[] = [];
const root = parse(readFileSync(join(BUNDLE, "databricks.yml"), "utf8")) as Obj;
let merged: Obj = root;
const resourceFiles: Record<string, string> = {}; // resource key → file it was defined in
for (const pattern of (root.include as string[] | undefined) ?? []) {
  const dir = join(BUNDLE, dirname(pattern));
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yml")).sort()) {
    const doc = parse(readFileSync(join(dir, f), "utf8")) as Obj;
    for (const [type, items] of Object.entries((doc.resources as Obj | undefined) ?? {})) {
      for (const key of Object.keys(items as Obj)) resourceFiles[`${type}.${key}`] = join(dir, f);
    }
    merged = merge(merged, doc);
  }
}

// 1. JSON Schema validation.
let schemaPath = schemaArg ? resolve(schemaArg) : join(ROOT, "out/.cache/bundle-jsonschema.json");
if (!existsSync(schemaPath)) {
  mkdirSync(dirname(schemaPath), { recursive: true });
  const res = await fetch(SCHEMA_URL);
  if (!res.ok) throw new Error(`could not download ${SCHEMA_URL}: ${res.status}`);
  writeFileSync(schemaPath, await res.text());
  schemaPath = resolve(schemaPath);
}
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")) as object);
if (!validate(merged)) {
  for (const e of validate.errors ?? []) errors.push(`schema: ${e.instancePath} ${e.message ?? ""} ${JSON.stringify(e.params)}`);
}

// 2. Referenced paths.
const resources = merged.resources as Obj;
const rel = (key: string, p: string): string => resolve(dirname(resourceFiles[key] ?? BUNDLE), p.replace(/\/\*\*$/, ""));
const pipeline = (resources.pipelines as Obj).quandong_twin as Obj;
for (const p of [pipeline.root_path as string, ...((pipeline.libraries as { glob: { include: string } }[]).map((l) => l.glob.include))]) {
  if (!existsSync(rel("pipelines.quandong_twin", p))) errors.push(`pipeline path does not exist: ${p}`);
}
const dash = (resources.dashboards as Obj).quandong_ot as Obj;
const dashPath = rel("dashboards.quandong_ot", dash.file_path as string);
if (!existsSync(dashPath)) errors.push(`dashboard file does not exist: ${String(dash.file_path)}`);

// 3. Dashboard datasets only use tables the pipeline defines.
if (existsSync(dashPath)) {
  const lv = JSON.parse(readFileSync(dashPath, "utf8")) as { datasets: { name: string; queryLines: string[] }[]; pages: { layout: { widget: { queries?: { query: { datasetName: string } }[] } }[] }[] };
  const sources = ["bronze.py", "silver.py", "gold.py"].map((f) => readFileSync(join(BUNDLE, "src/pipeline", f), "utf8")).join("\n");
  const defined = new Set([...sources.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]));
  for (const s of ["asset_inventory", "network_flows", "protocol_events", "process_telemetry", "remote_access", "security_alerts", "compliance_evidence", "scenario_log"]) {
    defined.add(`bronze_${s}`);
    defined.add(`silver_${s}`);
  }
  const names = new Set(lv.datasets.map((d) => d.name));
  for (const d of lv.datasets) {
    for (const m of d.queryLines.join(" ").matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)) {
      if (!defined.has(m[1] ?? "")) errors.push(`dashboard dataset ${d.name} queries unknown table ${m[1] ?? ""}`);
    }
  }
  for (const page of lv.pages) {
    for (const item of page.layout) {
      for (const q of item.widget.queries ?? []) {
        if (!names.has(q.query.datasetName)) errors.push(`widget uses unknown dataset ${q.query.datasetName}`);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✖ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`bundle OK: ${Object.keys(resourceFiles).length} resources validated against the bundle schema`);
